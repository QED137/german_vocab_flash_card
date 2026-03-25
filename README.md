# B1/B2 Flashcard App

React + FastAPI app for studying German vocabulary as flashcards.

The app supports:
- `B1` and `B2` vocabulary levels
- manual word entry
- DOCX import
- sentence editing
- lesson-based B2 flashcard groups

## Project Structure

```text
b2-vocab-app/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── import_docx.py
│   ├── bulk_import_docx.py
│   └── vocab.db
├── frontend/
│   ├── src/
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Requirements

For Docker setup:
- Docker
- Docker Compose

For local setup:
- Python 3.11+
- Node.js 18+
- npm

Backend Python dependencies are listed in [backend/requirements.txt](/home/graviton/Workspace/gitRepo/flashCard/b2-vocab-app/backend/requirements.txt).

## Run With Docker

From the `b2-vocab-app` folder:

```bash
make up
```

App URLs:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

Stop containers:

```bash
make down
```

Rebuild after dependency changes:

```bash
make rebuild
```

Useful commands:

```bash
make ps
make logs
```

## Run Locally Without Docker

### 1. Install backend dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Start the backend

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
```

### 4. Start the frontend

```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

## Vocabulary Import

### Import from the app

Open the frontend, choose `B1` or `B2`, and upload a `.docx` file from the import section.

### Bulk import many DOCX files

If your DOCX files are in a folder such as `/home/.../docxfile`, run:

```bash
python3 backend/bulk_import_docx.py --dir /path/to/docxfile
```

Example:

```bash
python3 backend/bulk_import_docx.py --dir /home/graviton/Workspace/gitRepo/flashCard/docxfile
```

## B2 Lesson-Based Flashcards

B2 is grouped by lesson name instead of fixed numeric blocks.

Lesson names are detected from:
1. the first DOCX heading starting with `Lektion ...`
2. the DOCX filename if no lesson heading is found

For the 12 B2 lesson files, this creates 12 named B2 flashcard groups such as:
- `Lektion 1: Sprache und Kommunikation`
- `Lektion 2: Gefühle und Beziehungen`
- `Lektion 3: Im In- und Ausland`

If older B2 words were imported before the lesson field existed, they may appear as an ungrouped B2 set until re-imported.

## Database

- Local SQLite database path: `backend/vocab.db`
- The database file is ignored by git
- Recommended workflow: commit code and import scripts, not the generated database file

## Notes

- `backend/requirements.txt` is the source of backend Python packages
- `frontend/package.json` is the source of frontend packages
- If dependencies change, rebuild Docker images or reinstall locally
