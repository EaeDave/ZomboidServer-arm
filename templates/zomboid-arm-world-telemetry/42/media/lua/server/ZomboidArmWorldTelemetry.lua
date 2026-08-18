-- Installed in the base server's media/lua/server tree. The metadata-only B42
-- directory supplies a stable getModFileWriter data root; it is not in Mods=.
local MOD_ID = "ZomboidArmWorldTelemetry"
local TELEMETRY_FILENAME = "world-time.txt"
local TELEMETRY_ALTERNATE_FILENAME = "world-time.txt.next"
local HEARTBEAT_TICKS = 300


local function integer(value)
    return math.floor(tonumber(value) or 0)
end

local function publish()
    local gameTime = getGameTime()
    if not gameTime then
        return
    end

    local worldAgeHours = tonumber(gameTime:getWorldAgeHours()) or 0
    local worldAgeMinutes = math.max(0, math.floor(worldAgeHours * 60 + 0.5))
    local filename = TELEMETRY_FILENAME
    if worldAgeMinutes % 2 == 1 then
        filename = TELEMETRY_ALTERNATE_FILENAME
    end

    -- Alternate complete snapshots because the Lua file writer truncates its target before
    -- writing. The status reader selects the newest valid file while the other slot remains
    -- available during a concurrent publish.
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
    local writer = getModFileWriter(MOD_ID, filename, true, false)
    if not writer then
        print("[ZomboidArmWorldTelemetry] could not open telemetry file")
        return
    end

    writer:write(payload)
    writer:close()
end

local function safePublish()
    local ok, errorMessage = pcall(publish)
    if not ok then
        print("[ZomboidArmWorldTelemetry] publish failed: " .. tostring(errorMessage))
    end
end

local heartbeatTicks = 0

local function safeHeartbeat()
    heartbeatTicks = heartbeatTicks + 1
    if heartbeatTicks < HEARTBEAT_TICKS then
        return
    end
    heartbeatTicks = 0
    safePublish()
end

Events.OnGameTimeLoaded.Add(safePublish)
Events.EveryOneMinute.Add(safePublish)
Events.OnTickEvenPaused.Add(safeHeartbeat)
