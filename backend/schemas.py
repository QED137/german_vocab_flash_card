from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


VocabularyLevel = Literal["B1", "B2"]


class WordBase(BaseModel):
    english_word: str = Field(..., min_length=1, max_length=120)
    level: VocabularyLevel = "B2"
    lesson: str | None = Field(default=None, max_length=160)
    part_of_speech: str | None = Field(default=None, max_length=50)
    meaning: str = Field(..., min_length=1)
    example_sentence: str | None = None
    notes: str | None = None


class WordCreate(WordBase):
    pass


class WordUpdate(BaseModel):
    english_word: str | None = Field(default=None, min_length=1, max_length=120)
    level: VocabularyLevel | None = None
    lesson: str | None = Field(default=None, max_length=160)
    part_of_speech: str | None = Field(default=None, max_length=50)
    meaning: str | None = Field(default=None, min_length=1)
    example_sentence: str | None = None
    notes: str | None = None


class WordRead(WordBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ImportResponse(BaseModel):
    imported: int
    skipped: int
    total_detected: int
    lesson: str | None = None
