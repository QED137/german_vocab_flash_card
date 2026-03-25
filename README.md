# B2/B1 Flashcard App (Docker)

Run and stop the full app with one command.

## Start

From `b2-vocab-app` folder:

```bash
make up
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

## Stop

```bash
make down
```

## Rebuild after dependency changes

```bash
make rebuild
```

This recreates containers with a fresh build and prints where frontend/backend are running.

## Useful commands

```bash
make ps
make logs
```

## Notes

- Database file stays in `backend/vocab.db` (because backend folder is mounted into container).
- Level-based import (`B1`/`B2`) and manual add features work the same in Docker.
