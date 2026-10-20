// MongoDbProvider.ts

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

class MongoDbProvider {
    constructor() {
        console.log('Create MongoDbProvider');
    }

    private initializeConnection() {
        console.log('Connecting to MongoDB...');

        const uri = process.env.MONGODB_URL;

        if (!uri) {
            console.error('MONGODB_URL environment variable is not set');
            process.exit(1);
        }

        mongoose
            .connect(uri, {
                serverSelectionTimeoutMS: 5000,
            })
            .then(() => {
                console.log('Successfully connected to MongoDB');
            })
            .catch((err) => {
                console.error('Could not connect to MongoDB...', err);
                process.exit(1);
            });
    }

    public initialize() {
        this.initializeConnection();
    }

    public getModel<T>(modelName: string, schema: mongoose.Schema<T>): mongoose.Model<T> {
        if (mongoose.models[modelName]) {
            return mongoose.model<T>(modelName);
        }
        return mongoose.model<T>(modelName, schema);
    }
}

export const mongoDbProvider = new MongoDbProvider();
