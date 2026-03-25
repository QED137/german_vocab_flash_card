from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class VocabWord(Base):
    __tablename__ = "vocab_words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    english_word: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="B2", index=True)
    lesson: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    part_of_speech: Mapped[str | None] = mapped_column(String(50), nullable=True)
    meaning: Mapped[str] = mapped_column(Text, nullable=False)
    example_sentence: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
