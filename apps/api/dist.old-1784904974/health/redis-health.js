import { createClient } from "redis";
export async function checkRedisHealth(url = process.env.REDIS_URL ?? "redis://localhost:6379") {
    const startedAt = performance.now();
    const client = createClient({
        url,
        socket: {
            connectTimeout: 1_500,
            reconnectStrategy: false,
        },
    });
    client.on("error", () => undefined);
    try {
        await client.connect();
        await client.ping();
        return {
            status: "ok",
            latencyMs: Math.round(performance.now() - startedAt),
        };
    }
    catch (error) {
        return {
            status: "unavailable",
            latencyMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.message : "Ismeretlen Redis hiba.",
        };
    }
    finally {
        if (client.isOpen) {
            await client.quit().catch(() => client.destroy());
        }
        else {
            client.destroy();
        }
    }
}
//# sourceMappingURL=redis-health.js.map