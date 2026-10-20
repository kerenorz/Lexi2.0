import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { mongoDbProvider } from './mongoDBProvider';
import { agentsRouter } from './routers/agentsRouter.router';
import { conversationsRouter } from './routers/conversationsRouter.router';
import { dataAggregationRouter } from './routers/dataAggregationRouter.router';
import { experimentsRouter } from './routers/experimentsRouter.router';
import { formsRouter } from './routers/formsRouter';
import { usersRouter } from './routers/usersRouter.router';
import { apiKeysRouter } from './routers/apiKeysRouter.router';
import { usersService } from './services/users.service';

dotenv.config();

const createAdminUser = (username: string, password: string) => {
    if (!username || !password) {
        console.warn('Username and password are required');
        process.exit(1);
    }

    usersService
        .createAdminUser(username, password)
        .then(() => {
            console.log('Admin user created successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Error creating admin user:', error);
            process.exit(1);
        });
};

// Builds the Express app without binding a port, so it can be mounted in-process.
export const createApp = () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

    const corsOptions = {
        origin: (origin: string | undefined, callback: Function) => {
            const allowedOrigins: string[] = [];
            if (process.env.NODE_ENV !== 'production') {
                allowedOrigins.push('http://localhost:3000');
            }
            if (process.env.FRONTEND_URL) {
                allowedOrigins.push(process.env.FRONTEND_URL);
            }
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
        // Custom headers are hidden from cross-origin JS unless exposed. The client reads
        // X-Lexi-Reveal to tell how to reveal a split reply (see streamMessage).
        exposedHeaders: ['X-Lexi-Reveal'],
    };
    app.use(cors(corsOptions));
    app.use(cookieParser());

    app.use('/health', (req, res) => res.status(200).send('OK'));
    app.use('/conversations', conversationsRouter());
    app.use('/experiments', experimentsRouter());
    app.use('/users', usersRouter());
    app.use('/agents', agentsRouter());
    app.use('/dataAggregation', dataAggregationRouter());
    app.use('/forms', formsRouter());
    // No /folderDownload route: it allowed path traversal (exposing .env) and was unused.
    app.use('/apiKeys', apiKeysRouter());

    // At runtime __dirname is server/build/, so this resolves to the bundled client build.
    const clientBuildPath = path.resolve(__dirname, '../client/build');
    app.use(express.static(clientBuildPath));

    // SPA catch-all. Must come after all API routes.
    app.get('*', (req, res) => {
        res.sendFile(path.resolve(clientBuildPath, 'index.html'));
    });

    return app;
};

const setupServer = () => {
    const PORT = process.env.PORT || 5000;
    createApp().listen(PORT, () => {
        console.log(`Server started on http://localhost:${PORT}`);
    });
};

// Boot only when run as the entrypoint; importing must not connect to the DB or listen.
const isEntrypoint = typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;

if (isEntrypoint) {
    mongoDbProvider.initialize();

    if (process.argv[2] === 'create-user') {
        const [, , , username, password] = process.argv;
        createAdminUser(username, password);
    } else {
        setupServer();
    }
}
