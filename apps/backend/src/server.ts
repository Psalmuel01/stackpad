import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import booksRouter from './routes/books';
import contentRouter from './routes/content';
import authorRouter from './routes/author';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    exposedHeaders: ['X-Payment-Required', 'WWW-Authenticate']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/books', booksRouter);
app.use('/api/content', contentRouter);
app.use('/api/author', authorRouter);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log('📚 Stackpad API ready');
    console.log(`🌐 Network: ${process.env.STACKS_NETWORK || 'testnet'}`);
});

export default app;
