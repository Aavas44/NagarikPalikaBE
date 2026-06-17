declare module "mongodb-memory-server" {
  export class MongoMemoryServer {
    static create(): Promise<MongoMemoryServer>;
    getUri(dbName?: string): string;
    stop(): Promise<boolean>;
  }
}
