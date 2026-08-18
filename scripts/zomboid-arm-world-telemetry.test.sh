#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOD_SCRIPT="$ROOT_DIR/templates/zomboid-arm-world-telemetry/media/lua/server/ZomboidArmWorldTelemetry.lua"

lua - "$MOD_SCRIPT" <<'LUA'
local script = arg[1]
local callbacks = {}
local filename


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
    OnTickEvenPaused = event(),
}


local worldAgeHours = 300.5

local gameTime = {
    getYear = function() return 1993 end,
    getMonth = function() return 6 end,
    getDayPlusOne = function() return 9 end,
    getHour = function() return 14 end,
    getMinutes = function() return 37 end,
    getDaysSurvived = function() return 12 end,
    getWorldAgeHours = function() return worldAgeHours end,
}

function getGameTime()
    return gameTime
end

function getModFileWriter(modId, filenameValue, createIfNull, append)
    assert(modId == "ZomboidArmWorldTelemetry")
    filename = filenameValue
    assert(createIfNull == true)
    assert(append == false)
    return {
        write = function(_, value) payload = value end,
        close = function() end,
    }
end

dofile(script)

assert(#callbacks == 3, "expected initial, periodic and paused-tick callbacks")

callbacks[1]()
assert(payload == '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18030}', payload)
assert(filename == "world-time.txt", filename)

worldAgeHours = 300.5166667
callbacks[2]()
assert(filename == "world-time.txt.next", filename)
assert(payload == '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18031}', payload)
worldAgeHours = 300.5333333
for _ = 1, 300 do
    callbacks[3]()
end
assert(filename == "world-time.txt", filename)
assert(payload == '{"protocolVersion":1,"year":1993,"month":7,"day":9,"hour":14,"minute":37,"daysSurvived":12,"worldAgeMinutes":18032}', payload)
print("zomboid-arm-world-telemetry-test=ok")
LUA
