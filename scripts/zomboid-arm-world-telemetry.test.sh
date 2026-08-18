#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD_SCRIPT="$ROOT_DIR/templates/zomboid-arm-world-telemetry/media/lua/server/ZomboidArmWorldTelemetry.lua"

lua - "$MOD_SCRIPT" <<'LUA'
local script = arg[1]
local callbacks = {}
local payload

local function event()
    return {
        Add = function(callback)
            table.insert(callbacks, callback)
        end,
    }
end

Events = {
    OnGameTimeLoaded = event(),
    EveryOneMinute = event(),
}

local gameTime = {
    getYear = function() return 1993 end,
    getMonth = function() return 6 end,
    getDayPlusOne = function() return 9 end,
    getHour = function() return 14 end,
    getMinutes = function() return 37 end,
    getDaysSurvived = function() return 12 end,
    getWorldAgeHours = function() return 300.5 end,
}

function getGameTime()
    return gameTime
end

function getModFileWriter(modId, filename, createIfNull, append)
    assert(modId == "ZomboidArmWorldTelemetry")
    assert(filename == "world-time.txt")
    assert(createIfNull == true)
    assert(append == false)
    return {
        write = function(_, value) payload = value end,
        close = function() end,
    }
end

dofile(script)
assert(#callbacks == 2, "expected initial and periodic callbacks")
callbacks[1]()
assert(payload == '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18030}', payload)
print("zomboid-arm-world-telemetry-test=ok")
LUA
