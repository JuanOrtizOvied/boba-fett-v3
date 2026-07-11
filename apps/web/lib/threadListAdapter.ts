// Thread list adapter is no longer needed — chat persistence is handled
// by FastAPI with AsyncPostgresSaver (see api/chat_routes.py).
// Thread ID is stored in the users table (active_thread_id).
