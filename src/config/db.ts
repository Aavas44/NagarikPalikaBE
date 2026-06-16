import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const MONGODB_URI =
  process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/nagarik-palika";

let memoryServer: MongoMemoryServer | null = null;

async function connectMemory(): Promise<void> {
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

  if (
    MONGODB_URI.includes("mongodb+srv://") &&
    /:\/\/[^@]+@[^/]+:\d+/.test(MONGODB_URI)
  ) {
    throw new Error(
      "Invalid MONGODB_URI: mongodb+srv URIs cannot include a port number"
    );
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (process.env.NODE_ENV === "production") {
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
