local MOD_ID = "ZomboidArmWorldTelemetry"
local TELEMETRY_FILENAME = "world-time.txt"

local function integer(value)
    return math.floor(tonumber(value) or 0)
end

local function publish()
    local gameTime = getGameTime()
    if not gameTime then
        return
    end

    local writer = getModFileWriter(MOD_ID, TELEMETRY_FILENAME, true, false)
    if not writer then
        print("[ZomboidArmWorldTelemetry] could not open telemetry file")
        return
    end

    local worldAgeHours = tonumber(gameTime:getWorldAgeHours()) or 0
    local worldAgeMinutes = math.max(0, math.floor(worldAgeHours * 60 + 0.5))
    local payload = string.format(
        '{"protocolVersion":1,"year":%d,"month":%d,"day":%d,"hour":%d,"minute":%d,"daysSurvived":%d,"worldAgeMinutes":%d}',
        integer(gameTime:getYear()),
        integer(gameTime:getMonth()) + 1,
        integer(gameTime:getDayPlusOne()),
        integer(gameTime:getHour()),
        integer(gameTime:getMinutes()),
        integer(gameTime:getDaysSurvived()),
        worldAgeMinutes
    )

    writer:write(payload)
    writer:close()
end

local function safePublish()
    local ok, errorMessage = pcall(publish)
    if not ok then
        print("[ZomboidArmWorldTelemetry] publish failed: " .. tostring(errorMessage))
    end
end

Events.OnGameTimeLoaded.Add(safePublish)
Events.EveryOneMinute.Add(safePublish)
