from __future__ import annotations

import argparse
from pathlib import Path

import crud
from database import SessionLocal
from import_docx import parse_docx_words


def import_directory(docx_dir: Path) -> tuple[int, int, int, int]:
    files = sorted(docx_dir.glob("*.docx"))
    imported_total = 0
    skipped_total = 0
    detected_total = 0
    failed_files = 0

    if not files:
        print(f"No .docx files found in: {docx_dir}")
        return imported_total, skipped_total, detected_total, failed_files

    db = SessionLocal()
    try:
        for file_path in files:
            try:
                lesson, words = parse_docx_words(str(file_path))
                imported, skipped = crud.bulk_create_words(db, words)
                detected = len(words)
                imported_total += imported
                skipped_total += skipped
                detected_total += detected
                print(
                    f"{file_path.name}: lesson={lesson or '-'}, detected={detected}, imported={imported}, skipped={skipped}"
                )
            except Exception as exc:
                failed_files += 1
                print(f"{file_path.name}: failed ({exc})")
    finally:
        db.close()

    return imported_total, skipped_total, detected_total, failed_files


def main() -> None:
    script_path = Path(__file__).resolve()
    default_dir = script_path.parent.parent / "docxfile"

    parser = argparse.ArgumentParser(description="Bulk import vocabulary from DOCX files")
    parser.add_argument(
        "--dir",
        default=str(default_dir),
        help="Directory containing .docx files (default: ../../docxfile)",
    )
    args = parser.parse_args()

    docx_dir = Path(args.dir).expanduser().resolve()
    if not docx_dir.exists() or not docx_dir.is_dir():
        raise SystemExit(f"Invalid directory: {docx_dir}")

    imported, skipped, detected, failed = import_directory(docx_dir)
    print("-")
    print(f"Directory: {docx_dir}")
    print(f"Total detected: {detected}")
    print(f"Total imported: {imported}")
    print(f"Total skipped: {skipped}")
    print(f"Failed files: {failed}")


if __name__ == "__main__":
    main()
