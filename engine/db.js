// This file creates ONE shared connection to your MongoDB database
// that the rest of the app reuses, instead of reconnecting every time.

const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;

if (!uri) {
    throw new Error(
        "MONGODB_URI is not set. Add it to your .env file locally, " +
        "and to Render's Environment tab in production."
    );
}

const client = new MongoClient(uri);

let dbInstance = null;

// Call this ONCE when the server starts up.
async function connectDB() {
    if (dbInstance) return dbInstance;
    await client.connect();
    dbInstance = client.db("ainegotiator");
    console.log("Connected to MongoDB Atlas.");
    return dbInstance;
}

// Every other file calls this to get the already-open connection.
function getDb() {
    if (!dbInstance) {
        throw new Error(
            "Database not connected yet. connectDB() must run first, at server startup."
        );
    }
    return dbInstance;
}

module.exports = { connectDB, getDb };
