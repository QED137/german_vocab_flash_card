from collections.abc import Iterable

from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
import schemas


def get_words(
    db: Session,
    level: schemas.VocabularyLevel | None = None,
    search: str | None = None,
    skip: int = 0,
    limit: int = 100,
):
    query = db.query(models.VocabWord)

    if level:
        query = query.filter(models.VocabWord.level == level)

    if search:
        like_term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                models.VocabWord.english_word.ilike(like_term),
                models.VocabWord.meaning.ilike(like_term),
                models.VocabWord.example_sentence.ilike(like_term),
                models.VocabWord.notes.ilike(like_term),
            )
        )

    return (
        query.order_by(models.VocabWord.english_word.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_word(db: Session, word_id: int):
    return db.query(models.VocabWord).filter(models.VocabWord.id == word_id).first()


def get_existing_word(
    db: Session,
    english_word: str,
    meaning: str,
    level: schemas.VocabularyLevel = "B2",
    lesson: str | None = None,
):
    query = db.query(models.VocabWord).filter(
        models.VocabWord.english_word == english_word.strip(),
        models.VocabWord.meaning == meaning.strip(),
        models.VocabWord.level == level,
    )

    if lesson:
        query = query.filter(models.VocabWord.lesson == lesson.strip())
    else:
        query = query.filter(models.VocabWord.lesson.is_(None))

    return query.first()


def create_word(db: Session, word: schemas.WordCreate):
    db_word = models.VocabWord(**word.model_dump())
    db.add(db_word)
    db.commit()
    db.refresh(db_word)
    return db_word


def update_word(db: Session, word_id: int, payload: schemas.WordUpdate):
    db_word = get_word(db, word_id)
    if not db_word:
        return None

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(db_word, field, value)

    db.commit()
    db.refresh(db_word)
    return db_word


def delete_word(db: Session, word_id: int):
    db_word = get_word(db, word_id)
    if not db_word:
        return False

    db.delete(db_word)
    db.commit()
    return True


def bulk_create_words(db: Session, words: Iterable[schemas.WordCreate]):
    imported = 0
    skipped = 0

    for word in words:
        exists = get_existing_word(db, word.english_word, word.meaning, word.level, word.lesson)
        if exists:
            skipped += 1
            continue
        create_word(db, word)
        imported += 1

    return imported, skipped
