# Stackpad Backend

This is the Express.js backend for Stackpad. It handles:
- Book metadata and content storage (PostgreSQL)
- x402 Payment Protocol verification
- Author dashboards and uploads

## Setup

1.  **Install Dependencies** (from root):
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    Copy `.env.example` to `.env` and configure your database and Stacks network settings.
    ```bash
    cp .env.example .env
    ```

3.  **Database Migration**:
    Initialize the database schema.
    ```bash
    npm run migrate
    ```

## Running the Server

### Development Mode
Runs the server with hot-reloading using `tsx watch`.

```bash
# From the root directory:
npm run backend

# OR from apps/backend:
cd apps/backend
npm run dev
```

The server will start on `http://localhost:3001`.

### Production Mode
Builds the TypeScript code and starts the node server.

```bash
npm run build
npm start
```

## API Endpoints

-   `GET /api/books`: List all books
-   `GET /api/books/:id`: Get book details
-   `GET /api/content/:bookId/page/:pageNum`: Get page content (requires payment headers for locked content)
-   `POST /api/author/upload`: Upload a new book (Author only)
