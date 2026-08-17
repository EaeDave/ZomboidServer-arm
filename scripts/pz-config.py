#!/usr/bin/env python3
"""Typed, path-confined Project Zomboid configuration reader and patcher."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCALAR = bool | int | float | str
SOURCE_SERVER = "server"
SOURCE_SANDBOX = "sandbox"

PROTECTED_SERVER_KEYS = {
    "ResetID",
    "ServerPlayerID",
    "Seed",
    "DefaultPort",
    "UDPPort",
    "RCONPort",
    "server_browser_announced_ip",
    "Password",
    "RCONPassword",
    "DiscordToken",
    "WebhookAddress",
    "SteamAuthKey",
    "EncryptionKey",
    "WSUseStaticIP",
    "Mods",
    "WorkshopItems",
    "Map",
}
SENSITIVE_SERVER_KEYS = {
    "Password",
    "RCONPassword",
    "DiscordToken",
    "WebhookAddress",
    "SteamAuthKey",
    "EncryptionKey",
}
PROTECTED_SANDBOX_PATHS = {"VERSION"}

CATEGORY_LABELS = {
    "general": "General",
    "access": "Access and identity",
    "players": "Players",
    "pvp": "PVP and safety",
    "safehouse": "Safehouses and factions",
    "sleep": "Sleep and time passage",
    "communication": "Chat, voice and integrations",
    "network": "Network and Steam",
    "security": "Anti-cheat and protection",
    "zombies": "Zombies",
    "loot": "Loot and items",
    "world": "World, weather and events",
    "survival": "Survival",
    "vehicles": "Vehicles",
    "animals": "Animals",
    "farming": "Farming and nature",
    "mods": "Mod options",
    "advanced": "Advanced",
}

FRIENDLY_LABELS = {
    "SleepAllowed": "Allow sleeping",
    "SleepNeeded": "Require sleep",
    "FastForwardMultiplier": "Sleep fast-forward speed",
    "PauseEmpty": "Pause when empty",
    "Public": "Public server",
    "PublicName": "Public name",
    "PublicDescription": "Public description",
    "MaxPlayers": "Maximum players",
    "PVP": "Allow PVP",
    "SafetySystem": "PVP safety system",
    "PlayerSafehouse": "Players can create safehouses",
    "Faction": "Allow factions",
    "DayLength": "Day length",
    "StartTime": "Start time",
    "WaterShut": "Water shutoff",
    "ElecShut": "Electricity shutoff",
    "HoursForLootRespawn": "Hours until loot respawn",
    "ZombieConfig.PopulationMultiplier": "Population multiplier",
}

SERVER_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("sleep", ("Sleep", "FastForward", "PauseEmpty")),
    ("pvp", ("PVP", "Safety", "War", "Sledgehammer", "Destruction")),
    ("safehouse", ("Safehouse", "SafeHouse", "Faction")),
    ("communication", ("Chat", "Voice", "Discord", "Webhook", "Radio", "Message")),
    ("security", ("AntiCheat", "DoLuaChecksum", "Ban", "Kick", "Checksum")),
    ("network", ("Port", "Steam", "UPnP", "Ping", "LoginQueue", "server_browser")),
    ("players", ("Player", "MaxPlayers", "Spawn", "DisplayUser", "Username", "Coop")),
    ("access", ("Public", "Open", "Password", "Whitelist", "RCON")),
]

SANDBOX_CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("zombies", ("Zombie", "Zombies", "Population", "Respawn", "Migrate", "Lore")),
    ("loot", ("Loot", "Item", "Weapon", "Ammo", "Food", "Literature", "Container", "Media", "Memento")),
    ("vehicles", ("Vehicle", "Car", "Traffic", "Siren", "Gas", "FuelStation")),
    ("animals", ("Animal", "Rat", "Mating", "Egg", "Predator")),
    ("farming", ("Farm", "Plant", "Compost", "Nature", "Fish", "Clay")),
    ("world", ("Day", "Start", "Climate", "Fog", "Rain", "Snow", "Erosion", "Helicopter", "MetaEvent", "WaterShut", "ElecShut", "Alarm")),
    ("survival", ("Stats", "Nutrition", "Injury", "Wound", "Corpse", "Temperature", "Fridge", "Generator", "Fire", "Muscle", "Discomfort")),
]


class ConfigError(Exception):
    pass


class StaleRevisionError(ConfigError):
    pass


@dataclass
class ParsedField:
    source: str
    path: str
    value: SCALAR
    value_type: str
    line: int
    description: str
    minimum: float | None = None
    maximum: float | None = None
    default: SCALAR | None = None
    options: list[dict[str, SCALAR]] | None = None
    indent: str = ""
    trailing_comma: bool = False
    validation_minimum: float | None = None
    validation_maximum: float | None = None


def scalar_type(value: SCALAR) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "string"


def parse_scalar(raw: str) -> SCALAR | None:
    value = raw.strip().rstrip(",").strip()
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if re.fullmatch(r"[-+]?\d+", value):
        return int(value)
    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][-+]?\d+)?", value):
        return float(value)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        quote = value[0]
        body = value[1:-1]
        body = body.replace(f"\\{quote}", quote).replace("\\n", "\n").replace("\\\\", "\\")
        return body
    if value == "" or value == "nil":
        return ""
    return value


def format_scalar(value: SCALAR, value_type: str, source: str) -> str:
    if value_type == "boolean":
        return "true" if value is True else "false"
    if value_type == "integer":
        return str(value)
    if value_type == "number":
        formatted = format(float(value), ".15g")
        exponent = re.search(r"[eE]", formatted)
        if exponent:
            index = exponent.start()
            return formatted if "." in formatted[:index] else f"{formatted[:index]}.0{formatted[index:]}"
        return formatted if "." in formatted else f"{formatted}.0"
    if source == SOURCE_SERVER:
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)


def friendly_label(path: str) -> str:
    if path in FRIENDLY_LABELS:
        return FRIENDLY_LABELS[path]
    leaf = path.rsplit(".", 1)[-1]
    label = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", leaf).replace("_", " ").strip()
    return label[:1].upper() + label[1:]


def category_for(source: str, path: str) -> str:
    leaf = path.rsplit(".", 1)[-1]
    if source == SOURCE_SANDBOX and "." in path and path.split(".", 1)[0] not in {"ZombieLore", "ZombieConfig", "MultiplierConfig"}:
        return "mods"
    rules = SERVER_CATEGORY_RULES if source == SOURCE_SERVER else SANDBOX_CATEGORY_RULES
    for category, needles in rules:
        if any(needle.lower() in leaf.lower() or needle.lower() in path.lower() for needle in needles):
            return category
    return "general" if source == SOURCE_SERVER else "advanced"


def metadata_from_comments(comments: Iterable[str], value_type: str, current: SCALAR) -> tuple[str, float | None, float | None, SCALAR | None, list[dict[str, SCALAR]] | None]:
    cleaned = [re.sub(r"^\s*(?:#|--)\s?", "", line).strip() for line in comments]
    description = " ".join(line for line in cleaned if line and not re.match(r"^[-+]?\d+(?:\.\d+)?\s*=", line))
    joined = " ".join(cleaned)
    minimum = maximum = None
    default: SCALAR | None = None
    min_match = re.search(r"\bMin(?:imum)?\s*[:=]\s*(-?\d+(?:\.\d+)?)", joined, re.I)
    max_match = re.search(r"\bMax(?:imum)?\s*[:=]\s*(-?\d+(?:\.\d+)?)", joined, re.I)
    default_match = re.search(r"\bDefault\s*[:=]\s*([^\s,;]+)", joined, re.I)
    if min_match:
        minimum = float(min_match.group(1))
    if max_match:
        maximum = float(max_match.group(1))
    if default_match:
        parsed = parse_scalar(default_match.group(1))
        if parsed is not None:
            default = parsed
    options: list[dict[str, SCALAR]] = []
    for line in cleaned:
        match = re.match(r"^(-?\d+)\s*=\s*(.+)$", line)
        if match:
            options.append({"value": int(match.group(1)), "label": match.group(2).strip()})
    return description[:2000], minimum, maximum, default, options or None


def parse_ini(path: Path) -> tuple[list[str], dict[str, ParsedField], list[str]]:
    try:
        lines = path.read_text(encoding="utf-8", errors="strict").splitlines(keepends=True)
    except UnicodeDecodeError as error:
        raise ConfigError("server configuration is not valid UTF-8") from error
    except OSError as error:
        raise ConfigError(f"server configuration is unavailable: {error.strerror}") from error
    fields: dict[str, ParsedField] = {}
    warnings: list[str] = []
    comments: list[str] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("#"):
            comments.append(line)
            continue
        if not stripped:
            continue
        match = re.match(r"^([A-Za-z0-9_]+)=(.*?)(?:\r?\n)?$", line)
        if not match:
            comments = []
            continue
        key, raw = match.groups()
        value = parse_scalar(raw)
        if value is None:
            warnings.append(f"Could not parse server setting {key}")
            comments = []
            continue
        value_type = scalar_type(value)
        description, minimum, maximum, default, options = metadata_from_comments(comments, value_type, value)
        validation_minimum, validation_maximum = minimum, maximum
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if minimum is not None and value < minimum:
                minimum = None
            if maximum is not None and value > maximum:
                maximum = None
        fields[key] = ParsedField(
            SOURCE_SERVER,
            key,
            value,
            value_type,
            index,
            description,
            minimum,
            maximum,
            default,
            options,
            validation_minimum=validation_minimum,
            validation_maximum=validation_maximum,
        )
        comments = []
    return lines, fields, warnings


def strip_lua_inline_comment(raw: str) -> str:
    quote: str | None = None
    escaped = False
    for index, char in enumerate(raw):
        if escaped:
            escaped = False
            continue
        if char == "\\" and quote:
            escaped = True
            continue
        if char in {'"', "'"}:
            quote = None if quote == char else (char if quote is None else quote)
            continue
        if quote is None and raw[index:index + 2] == "--":
            return raw[:index]
    return raw


def parse_lua(path: Path) -> tuple[list[str], dict[str, ParsedField], list[str]]:
    try:
        lines = path.read_text(encoding="utf-8", errors="strict").splitlines(keepends=True)
    except UnicodeDecodeError as error:
        raise ConfigError("sandbox configuration is not valid UTF-8") from error
    except OSError as error:
        raise ConfigError(f"sandbox configuration is unavailable: {error.strerror}") from error
    fields: dict[str, ParsedField] = {}
    warnings: list[str] = []
    stack: list[str] = []
    comments: list[str] = []
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("--"):
            comments.append(line)
            continue
        if not stripped:
            continue
        code = strip_lua_inline_comment(line).strip()
        table_match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*,?$", code)
        if table_match:
            name = table_match.group(1)
            if name == "SandboxVars" and not stack:
                stack.append("")
            else:
                stack.append(name)
            comments = []
            continue
        if re.match(r"^}\s*,?\s*$", code):
            if stack:
                stack.pop()
            comments = []
            continue
        scalar_match = re.match(r"^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)(,?)\s*$", strip_lua_inline_comment(line.rstrip("\r\n")))
        if not scalar_match or not stack:
            comments = []
            continue
        indent, key, raw, comma = scalar_match.groups()
        value = parse_scalar(raw)
        if value is None or (
            isinstance(value, str)
            and not (raw.strip().startswith(('"', "'")) or raw.strip() in {"nil", ""})
        ):
            warnings.append(f"Unsupported Lua expression at line {index + 1}: {key}")
            comments = []
            continue
        prefix = [part for part in stack if part]
        field_path = ".".join([*prefix, key])
        value_type = scalar_type(value)
        description, minimum, maximum, default, options = metadata_from_comments(comments, value_type, value)
        validation_minimum, validation_maximum = minimum, maximum
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if minimum is not None and value < minimum:
                minimum = None
            if maximum is not None and value > maximum:
                maximum = None
        fields[field_path] = ParsedField(
            SOURCE_SANDBOX,
            field_path,
            value,
            value_type,
            index,
            description,
            minimum,
            maximum,
            default,
            options,
            indent,
            bool(comma),
            validation_minimum,
            validation_maximum,
        )
        comments = []
    return lines, fields, warnings


def revision_for(ini: Path, sandbox: Path) -> str:
    digest = hashlib.sha256()
    for label, path in ((b"server\0", ini), (b"sandbox\0", sandbox)):
        digest.update(label)
        try:
            digest.update(path.read_bytes())
        except OSError as error:
            raise ConfigError(f"configuration is unavailable: {error.strerror}") from error
        digest.update(b"\0")
    return digest.hexdigest()


def field_payload(field: ParsedField) -> dict[str, Any]:
    leaf = field.path.rsplit(".", 1)[-1].lower()
    sensitive = (
        field.source == SOURCE_SERVER and field.path in SENSITIVE_SERVER_KEYS
    ) or any(
        marker in leaf
        for marker in ("password", "token", "secret", "webhook", "authkey", "encryptionkey", "privatekey", "apikey")
    )
    protected = sensitive or (
        field.source == SOURCE_SERVER and field.path in PROTECTED_SERVER_KEYS
    ) or (field.source == SOURCE_SANDBOX and field.path in PROTECTED_SANDBOX_PATHS)
    payload: dict[str, Any] = {
        "source": field.source,
        "path": field.path,
        "label": friendly_label(field.path),
        "category": category_for(field.source, field.path),
        "categoryLabel": CATEGORY_LABELS[category_for(field.source, field.path)],
        "type": field.value_type,
        "value": None if sensitive else field.value,
        "configured": bool(field.value) if sensitive else True,
        "description": field.description or f"Project Zomboid setting {field.path}.",
        "editable": not protected and not sensitive,
        "sensitive": sensitive,
        # PZ does not publish a reliable hot-reload matrix. Conservatively mark
        # every generic file setting as restart-required.
        "requiresRestart": True,
    }
    if field.minimum is not None:
        payload["minimum"] = field.minimum
    if field.maximum is not None:
        payload["maximum"] = field.maximum
    if field.default is not None and not sensitive:
        payload["defaultValue"] = field.default
    if field.options:
        payload["options"] = field.options
    return payload


def snapshot(ini: Path, sandbox: Path) -> tuple[dict[str, Any], dict[tuple[str, str], ParsedField], tuple[list[str], list[str]]]:
    ini_lines, ini_fields, ini_warnings = parse_ini(ini)
    sandbox_lines, sandbox_fields, sandbox_warnings = parse_lua(sandbox)
    all_fields = [*ini_fields.values(), *sandbox_fields.values()]
    all_fields.sort(key=lambda item: (item.source, category_for(item.source, item.path), item.path.lower()))
    payload = {
        "revision": revision_for(ini, sandbox),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "fields": [field_payload(field) for field in all_fields],
        "warnings": [*ini_warnings, *sandbox_warnings][:100],
    }
    lookup = {(field.source, field.path): field for field in all_fields}
    return payload, lookup, (ini_lines, sandbox_lines)


def validate_value(field: ParsedField, value: Any) -> SCALAR:
    if field.value_type == "boolean":
        if not isinstance(value, bool):
            raise ConfigError(f"{field.path} must be a boolean")
    elif field.value_type == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ConfigError(f"{field.path} must be an integer")
    elif field.value_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ConfigError(f"{field.path} must be a number")
        value = float(value)
    elif field.value_type == "string":
        if not isinstance(value, str) or len(value) > 4096 or "\x00" in value or "\r" in value or "\n" in value:
            raise ConfigError(f"{field.path} must be a single-line string up to 4096 characters")
        if field.source == SOURCE_SERVER and parse_scalar(value) != value:
            raise ConfigError(
                f"{field.path} cannot use edge whitespace or a value that looks boolean, numeric or quoted"
            )
    else:
        raise ConfigError(f"unsupported type for {field.path}")
    numeric = isinstance(value, (int, float)) and not isinstance(value, bool)
    minimum = field.validation_minimum if field.validation_minimum is not None else field.minimum
    maximum = field.validation_maximum if field.validation_maximum is not None else field.maximum
    if numeric and minimum is not None and value < minimum:
        raise ConfigError(f"{field.path} must be at least {minimum:g}")
    if numeric and maximum is not None and value > maximum:
        raise ConfigError(f"{field.path} must be at most {maximum:g}")
    # Enumerations extracted from comments are UI hints; mod and game comments
    # are not guaranteed to list every accepted value.
    return value


def write_temp(path: Path, lines: list[str]) -> Path:
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".pztmp", dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
            handle.writelines(lines)
            handle.flush()
            os.fsync(handle.fileno())
        shutil.copystat(path, temp)
        stat = path.stat()
        try:
            os.chown(temp, stat.st_uid, stat.st_gid)
        except PermissionError:
            pass
        return temp
    except Exception:
        temp.unlink(missing_ok=True)
        raise


def create_backup(path: Path, timestamp: str, keep: int = 10) -> Path:
    backup = path.with_name(f"{path.name}.bak.{timestamp}")
    collision = 1
    while backup.exists():
        backup = path.with_name(f"{path.name}.bak.{timestamp}.{collision}")
        collision += 1
    shutil.copy2(path, backup)
    existing = sorted(path.parent.glob(f"{path.name}.bak.*"), key=lambda item: item.stat().st_mtime_ns)
    for stale in existing[:-keep]:
        stale.unlink(missing_ok=True)
    return backup


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


@contextmanager
def configuration_lock(ini: Path):
    lock_path = ini.with_name(".pz-config.lock")
    with lock_path.open("a+") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def transaction_paths(ini: Path) -> tuple[Path, Path, Path]:
    return (
        ini.with_name(".pz-config-transaction.json"),
        ini.with_name(f".{ini.name}.pz-original"),
        ini.with_name(".sandbox.pz-original"),
    )


def restore_copy(copy: Path, target: Path) -> None:
    descriptor, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".pzrestore", dir=target.parent)
    os.close(descriptor)
    temp = Path(name)
    try:
        shutil.copy2(copy, temp)
        with temp.open("rb") as handle:
            os.fsync(handle.fileno())
        os.replace(temp, target)
        fsync_directory(target.parent)
    finally:
        temp.unlink(missing_ok=True)


def recover_transaction(ini: Path, sandbox: Path) -> None:
    journal, ini_original, sandbox_original = transaction_paths(ini)
    if not journal.exists():
        # A crash before publishing the journal cannot have replaced either
        # target, so any unpublished originals are safe to discard.
        ini_original.unlink(missing_ok=True)
        sandbox_original.unlink(missing_ok=True)
        return
    try:
        record = json.loads(journal.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConfigError("configuration transaction journal is invalid; manual recovery required") from error
    expected = {"ini": str(ini.resolve()), "sandbox": str(sandbox.resolve())}
    if record != expected or not ini_original.exists() or not sandbox_original.exists():
        raise ConfigError("configuration transaction cannot be recovered automatically")
    restore_copy(ini_original, ini)
    restore_copy(sandbox_original, sandbox)
    journal.unlink()
    ini_original.unlink()
    sandbox_original.unlink()
    fsync_directory(journal.parent)


def commit_transaction(ini: Path, sandbox: Path, ini_temp: Path, sandbox_temp: Path) -> None:
    journal, ini_original, sandbox_original = transaction_paths(ini)
    if journal.exists() or ini_original.exists() or sandbox_original.exists():
        raise ConfigError("unfinished configuration transaction exists")
    shutil.copy2(ini, ini_original)
    shutil.copy2(sandbox, sandbox_original)
    for original in (ini_original, sandbox_original):
        with original.open("rb") as handle:
            os.fsync(handle.fileno())
    fsync_directory(ini_original.parent)
    if sandbox_original.parent != ini_original.parent:
        fsync_directory(sandbox_original.parent)
    descriptor, name = tempfile.mkstemp(prefix=".pz-config-journal.", dir=journal.parent)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump({"ini": str(ini.resolve()), "sandbox": str(sandbox.resolve())}, handle)
        handle.flush()
        os.fsync(handle.fileno())
    journal_temp = Path(name)
    os.replace(journal_temp, journal)
    fsync_directory(journal.parent)
    try:
        os.replace(ini_temp, ini)
        fsync_directory(ini.parent)
        if os.environ.get("PZ_CONFIG_FAIL_AFTER_INI_REPLACE") == "1":
            raise OSError("injected failure after server configuration replacement")
        os.replace(sandbox_temp, sandbox)
        fsync_directory(sandbox.parent)
    except Exception:
        recover_transaction(ini, sandbox)
        raise
    journal.unlink()
    ini_original.unlink()
    sandbox_original.unlink()
    fsync_directory(journal.parent)


def _apply_update(ini: Path, sandbox: Path, request: dict[str, Any]) -> dict[str, Any]:
    if set(request) - {"expectedRevision", "createBackup", "changes"}:
        raise ConfigError("unknown update fields are not accepted")
    expected = request.get("expectedRevision")
    changes = request.get("changes")
    create_backups = request.get("createBackup", True)
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ConfigError("expectedRevision must be a SHA-256 revision")
    if create_backups is not True:
        raise ConfigError("createBackup must be true; every update requires recovery backups")
    if not isinstance(changes, list) or not 1 <= len(changes) <= 200:
        raise ConfigError("changes must contain between 1 and 200 entries")

    current, lookup, (ini_lines, sandbox_lines) = snapshot(ini, sandbox)
    if current["revision"] != expected:
        raise StaleRevisionError("configuration changed since it was loaded")
    _, _, original_ini_warnings = parse_ini(ini)
    _, _, original_sandbox_warnings = parse_lua(sandbox)

    normalized: list[tuple[ParsedField, SCALAR]] = []
    seen: set[tuple[str, str]] = set()
    for change in changes:
        if not isinstance(change, dict) or set(change) != {"source", "path", "value"}:
            raise ConfigError("each change must contain only source, path and value")
        source, path = change.get("source"), change.get("path")
        if source not in {SOURCE_SERVER, SOURCE_SANDBOX} or not isinstance(path, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", path):
            raise ConfigError("invalid configuration path")
        identity = (source, path)
        if identity in seen:
            raise ConfigError(f"duplicate change for {path}")
        seen.add(identity)
        field = lookup.get(identity)
        if not field:
            raise ConfigError(f"unknown configuration setting {source}:{path}")
        payload = field_payload(field)
        if not payload["editable"]:
            raise ConfigError(f"{path} is protected and must use its dedicated workflow")
        normalized.append((field, validate_value(field, change.get("value"))))

    changed_paths: list[str] = []
    for field, value in normalized:
        if field.value == value:
            continue
        changed_paths.append(f"{field.source}:{field.path}")
        if field.source == SOURCE_SERVER:
            newline = "\n" if ini_lines[field.line].endswith("\n") else ""
            ini_lines[field.line] = f"{field.path}={format_scalar(value, field.value_type, field.source)}{newline}"
        else:
            newline = "\n" if sandbox_lines[field.line].endswith("\n") else ""
            leaf = field.path.rsplit(".", 1)[-1]
            comma = "," if field.trailing_comma else ""
            sandbox_lines[field.line] = f"{field.indent}{leaf} = {format_scalar(value, field.value_type, field.source)}{comma}{newline}"

    if not changed_paths:
        return {"changed": [], "backupPaths": [], "revision": current["revision"], "requiresRestart": False}

    backups: list[Path] = []
    ini_temp = write_temp(ini, ini_lines)
    sandbox_temp = write_temp(sandbox, sandbox_lines)
    try:
        _, verified_ini, ini_warnings = parse_ini(ini_temp)
        _, verified_sandbox, sandbox_warnings = parse_lua(sandbox_temp)
        new_warnings = (set(ini_warnings) - set(original_ini_warnings)) | (
            set(sandbox_warnings) - set(original_sandbox_warnings)
        )
        if new_warnings:
            raise ConfigError("updated configuration introduces unparsable entries")
        verified = {
            **{(SOURCE_SERVER, path): field for path, field in verified_ini.items()},
            **{(SOURCE_SANDBOX, path): field for path, field in verified_sandbox.items()},
        }
        for field, intended in normalized:
            candidate = verified.get((field.source, field.path))
            if field.value != intended and (candidate is None or candidate.value != intended):
                raise ConfigError(f"could not verify updated value for {field.path}")
        if revision_for(ini, sandbox) != current["revision"]:
            raise StaleRevisionError("configuration changed while the update was being prepared")
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        backups = [create_backup(ini, timestamp), create_backup(sandbox, timestamp)]
        commit_transaction(ini, sandbox, ini_temp, sandbox_temp)
    finally:
        ini_temp.unlink(missing_ok=True)
        sandbox_temp.unlink(missing_ok=True)

    after, _, _ = snapshot(ini, sandbox)
    return {
        "changed": changed_paths,
        "backupPaths": [str(path) for path in backups],
        "revision": after["revision"],
        "requiresRestart": True,
    }


def apply_update(ini: Path, sandbox: Path, request: dict[str, Any]) -> dict[str, Any]:
    with configuration_lock(ini):
        recover_transaction(ini, sandbox)
        return _apply_update(ini, sandbox, request)


def load_request() -> dict[str, Any]:
    try:
        value = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        raise ConfigError("request must be valid JSON") from error
    if not isinstance(value, dict):
        raise ConfigError("request must be a JSON object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("read", "update"))
    parser.add_argument("--ini", required=True, type=Path)
    parser.add_argument("--sandbox", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "read":
            with configuration_lock(args.ini):
                recover_transaction(args.ini, args.sandbox)
                result, _, _ = snapshot(args.ini, args.sandbox)
        else:
            result = apply_update(args.ini, args.sandbox, load_request())
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except StaleRevisionError as error:
        print(json.dumps({"error": {"code": "stale_revision", "message": str(error)}}), file=sys.stderr)
        return 73
    except ConfigError as error:
        print(json.dumps({"error": {"code": "invalid_config", "message": str(error)}}), file=sys.stderr)
        return 64
    except Exception:
        print(json.dumps({"error": {"code": "config_error", "message": "configuration operation failed"}}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
