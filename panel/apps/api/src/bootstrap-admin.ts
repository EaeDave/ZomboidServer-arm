import { eq } from "drizzle-orm";
import { sessions, users } from "@zomboid/db";
import { createDatabase } from "@zomboid/db/client";

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
if (!email || email.length < 3 || email.length > 320 || !email.includes("@")) {
  throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid 3-320 character email");
}
if (!password || password.length < 12 || password.length > 256) {
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD must contain 12-256 characters");
}

const { db, client } = createDatabase();

try {
  const passwordHash = await Bun.password.hash(password);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing && process.env.BOOTSTRAP_ADMIN_ALLOW_UPDATE !== "1") {
    throw new Error("admin user already exists; set BOOTSTRAP_ADMIN_ALLOW_UPDATE=1 to rotate it");
  }

  if (existing) {
    await db.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ passwordHash, role: "admin" })
        .where(eq(users.id, existing.id));
      await transaction.delete(sessions).where(eq(sessions.userId, existing.id));
    });
    console.log("Updated admin user and revoked existing sessions");
  } else {
    await db.insert(users).values({ email, passwordHash, role: "admin" });
    console.log("Created admin user");
  }
} finally {
  await client.end({ timeout: 5 });
}
