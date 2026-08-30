import dns from "node:dns";
import mongoose from "mongoose";

// Node 18–20 + mongodb+srv often fails over IPv6 with an empty AggregateError.
dns.setDefaultResultOrder("ipv4first");

const MONGODB_URI =
  process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/nagarik-palika";

const CONNECT_OPTIONS: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 15_000,
  family: 4,
};

let memoryServer: import("mongodb-memory-server").MongoMemoryServer | null = null;

async function connectMemory(): Promise<void> {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri("nagarik-palika");
  await mongoose.connect(uri);
  console.log("Connected to in-memory MongoDB (development fallback)");
}

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState >= 1) return;

  if (process.env.USE_MEMORY_DB === "true") {
    await connectMemory();
    return;
  }

  const isAtlas = MONGODB_URI.includes("mongodb+srv://");

  if (isAtlas && /:\/\/[^@]+@[^/]+:\d+/.test(MONGODB_URI)) {
    throw new Error(
      "Invalid MONGODB_URI: mongodb+srv URIs cannot include a port number"
    );
  }

  try {
    await mongoose.connect(MONGODB_URI, CONNECT_OPTIONS);
    console.log(`Connected to MongoDB (${isAtlas ? "Atlas" : "local"})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (process.env.NODE_ENV === "production" || isAtlas) {
      if (message.includes("bad auth") || message.includes("Authentication failed")) {
        throw new Error("MongoDB authentication failed. Check your Atlas username and password.");
      }
      throw err;
    }

    console.warn("Could not connect to configured MongoDB — using in-memory database.");
    console.warn(message);
    await connectMemory();
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
