from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

import crud
import models
import schemas
from database import SessionLocal, engine
from import_docx import parse_docx_words

models.Base.metadata.create_all(bind=engine)


def ensure_level_column() -> None:
    with engine.begin() as connection:
        rows = connection.execute(text("PRAGMA table_info(vocab_words)")).fetchall()
        column_names = [row[1] for row in rows]
        if "level" not in column_names:
            connection.execute(
                text("ALTER TABLE vocab_words ADD COLUMN level VARCHAR(10) NOT NULL DEFAULT 'B2'")
            )
        if "lesson" not in column_names:
            connection.execute(text("ALTER TABLE vocab_words ADD COLUMN lesson VARCHAR(160)"))


ensure_level_column()

app = FastAPI(title="B2 Vocabulary App API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/words", response_model=list[schemas.WordRead])
def list_words(
    level: schemas.VocabularyLevel | None = Query(default="B2"),
    search: str | None = Query(default=None, min_length=1),
    skip: int = 0,
    limit: int = Query(default=100, le=200),
    db: Session = Depends(get_db),
):
    return crud.get_words(db, level=level, search=search, skip=skip, limit=limit)


@app.post("/words", response_model=schemas.WordRead, status_code=201)
def create_word(word: schemas.WordCreate, db: Session = Depends(get_db)):
    existing = crud.get_existing_word(db, word.english_word, word.meaning, word.level, word.lesson)
    if existing:
        raise HTTPException(status_code=409, detail="Word already exists")
    return crud.create_word(db, word)


@app.put("/words/{word_id}", response_model=schemas.WordRead)
def update_word(word_id: int, payload: schemas.WordUpdate, db: Session = Depends(get_db)):
    updated = crud.update_word(db, word_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Word not found")
    return updated


@app.delete("/words/{word_id}", status_code=204)
def delete_word(word_id: int, db: Session = Depends(get_db)):
    deleted = crud.delete_word(db, word_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Word not found")
    return None


@app.post("/import-docx", response_model=schemas.ImportResponse)
async def import_docx(
    file: UploadFile = File(...),
    level: schemas.VocabularyLevel = Form(default="B2"),
    db: Session = Depends(get_db),
):
    suffix = Path(file.filename or "upload.docx").suffix.lower()
    if suffix != ".docx":
        raise HTTPException(status_code=400, detail="Only .docx files are supported")

    with NamedTemporaryFile(delete=False, suffix=".docx") as temp_file:
        temp_file.write(await file.read())
        temp_path = temp_file.name

    try:
        detected_lesson, parsed_words = parse_docx_words(temp_path)
        words = [word.model_copy(update={"level": level}) for word in parsed_words]
        imported, skipped = crud.bulk_create_words(db, words)
        return schemas.ImportResponse(
            imported=imported,
            skipped=skipped,
            total_detected=len(words),
            lesson=detected_lesson,
        )
    finally:
        Path(temp_path).unlink(missing_ok=True)
