import React, { useEffect, useMemo, useState } from 'react';
import { createWord, fetchWords, importDocx, updateWord } from './api';

const BLOCK_SIZE = 20;
const FETCH_LIMIT = 200;
const AGAIN_OFFSET = 3;
const HARD_OFFSET = 7;
const PROGRESS_STORAGE_KEY_BASE = 'flashcard_progress_v1';

function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function insertAtOffset(queue, card, offset) {
  const nextQueue = [...queue];
  const position = Math.min(offset, nextQueue.length);
  nextQueue.splice(position, 0, card);
  return nextQueue;
}

function getBlockCards(studyOrder, blockIndex) {
  const blockStart = blockIndex * BLOCK_SIZE;
  return studyOrder.slice(blockStart, blockStart + BLOCK_SIZE);
}

function naturalCompare(valueA, valueB) {
  return valueA.localeCompare(valueB, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function getLessonLabel(word) {
  const rawLesson = typeof word?.lesson === 'string' ? word.lesson.trim() : '';
  return rawLesson || 'Ungrouped B2';
}

function buildPracticeGroups(words, level) {
  if (!Array.isArray(words) || words.length === 0) {
    return [];
  }

  if (level === 'B2') {
    const grouped = new Map();

    for (const word of words) {
      const lessonLabel = getLessonLabel(word);
      const existing = grouped.get(lessonLabel);
      if (existing) {
        existing.cards.push(word);
        continue;
      }

      grouped.set(lessonLabel, {
        key: lessonLabel,
        label: lessonLabel,
        cards: [word],
      });
    }

    return [...grouped.values()].sort((groupA, groupB) => naturalCompare(groupA.label, groupB.label));
  }

  return Array.from({ length: Math.ceil(words.length / BLOCK_SIZE) }, (_, index) => ({
    key: `block-${index + 1}`,
    label: `Block ${index + 1}`,
    cards: getBlockCards(words, index),
  }));
}

function orderWordsForLevel(words, level) {
  if (level !== 'B2') {
    return shuffleArray(words);
  }

  return [...words].sort((wordA, wordB) => {
    const lessonCompare = naturalCompare(getLessonLabel(wordA), getLessonLabel(wordB));
    if (lessonCompare !== 0) {
      return lessonCompare;
    }

    return naturalCompare(wordA.english_word, wordB.english_word);
  });
}

function toWordMap(words) {
  return new Map(words.map((word) => [word.id, word]));
}

function mapIdsToWords(ids, wordMap) {
  if (!Array.isArray(ids)) {
    return [];
  }

  const mapped = [];
  for (const id of ids) {
    const word = wordMap.get(id);
    if (!word) {
      return null;
    }
    mapped.push(word);
  }
  return mapped;
}

function readSavedProgress(words, level) {
  try {
    const raw = window.localStorage.getItem(`${PROGRESS_STORAGE_KEY_BASE}_${level}`);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const wordMap = toWordMap(words);
    const savedStudyOrder = mapIdsToWords(parsed.studyOrderIds, wordMap);
    const savedQueue = mapIdsToWords(parsed.queueIds, wordMap);

    if (!savedStudyOrder || !savedQueue || !savedStudyOrder.length) {
      return null;
    }

    if (level === 'B2' && !Number.isInteger(parsed.activeGroupIndex)) {
      return null;
    }

    const savedGroups = buildPracticeGroups(savedStudyOrder, level);
    const legacyBlockStart = Number.isInteger(parsed.blockStart) ? parsed.blockStart : 0;
    const legacyGroupIndex = level === 'B2' ? 0 : Math.max(0, Math.floor(legacyBlockStart / BLOCK_SIZE));
    const safeGroupIndex = Number.isInteger(parsed.activeGroupIndex)
      ? Math.max(0, Math.min(parsed.activeGroupIndex, Math.max(0, savedGroups.length - 1)))
      : Math.max(0, Math.min(legacyGroupIndex, Math.max(0, savedGroups.length - 1)));

    const safeStats = {
      reviewed: Number(parsed.stats?.reviewed || 0),
      again: Number(parsed.stats?.again || 0),
      hard: Number(parsed.stats?.hard || 0),
      good: Number(parsed.stats?.good || 0),
      easy: Number(parsed.stats?.easy || 0),
      cyclesCompleted: Number(parsed.stats?.cyclesCompleted || 0),
    };

    return {
      studyOrder: savedStudyOrder,
      queue: savedQueue,
      activeGroupIndex: safeGroupIndex,
      completedInBlock: Number(parsed.completedInBlock || 0),
      revealed: Boolean(parsed.revealed),
      stats: safeStats,
    };
  } catch {
    return null;
  }
}

function clearSavedProgress(level) {
  window.localStorage.removeItem(`${PROGRESS_STORAGE_KEY_BASE}_${level}`);
}

function getApplicationSentence(card) {
  if (!card) {
    return 'No sentence available for this card.';
  }

  if (typeof card.example_sentence === 'string' && card.example_sentence.trim()) {
    return card.example_sentence.trim();
  }

  if (typeof card.notes === 'string' && card.notes.trim()) {
    const lines = card.notes
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const sentenceLine = lines.find((line) =>
      /^example\s*:|^beispiel\s*:|^application\s*sentence\s*:/i.test(line),
    );

    if (sentenceLine) {
      const value = sentenceLine.split(':').slice(1).join(':').trim();
      if (value) {
        return value;
      }
    }
  }

  return 'No sentence available for this card.';
}

function getSentenceEnglishTranslation(card) {
  if (!card || typeof card.notes !== 'string' || !card.notes.trim()) {
    return '';
  }

  const lines = card.notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const translationLine = lines.find((line) => /^translation\s*\(en\)\s*:/i.test(line));
  if (!translationLine) {
    return '';
  }

  return translationLine.split(':').slice(1).join(':').trim();
}

function buildNotesWithTranslation(existingNotes, translation) {
  const cleanTranslation = translation.trim();
  const notesLines = typeof existingNotes === 'string'
    ? existingNotes
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    : [];

  const withoutTranslation = notesLines.filter(
    (line) => !/^translation\s*\(en\)\s*:/i.test(line),
  );

  if (cleanTranslation) {
    withoutTranslation.push(`Translation (EN): ${cleanTranslation}`);
  }

  return withoutTranslation.length ? withoutTranslation.join('\n') : null;
}

function getNotesWithoutTranslation(card) {
  if (!card || typeof card.notes !== 'string' || !card.notes.trim()) {
    return '';
  }

  return card.notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^translation\s*\(en\)\s*:/i.test(line))
    .join('\n');
}

export default function App() {
  const [selectedLevel, setSelectedLevel] = useState('B2');
  const [onlyWithSentence, setOnlyWithSentence] = useState(true);
  const [allWords, setAllWords] = useState([]);
  const [studyOrder, setStudyOrder] = useState([]);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [queue, setQueue] = useState([]);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingSentence, setSavingSentence] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [entryMode, setEntryMode] = useState('import');
  const [savingManual, setSavingManual] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sentenceDraft, setSentenceDraft] = useState('');
  const [translationDraft, setTranslationDraft] = useState('');
  const [manualForm, setManualForm] = useState({
    english_word: '',
    meaning: '',
    example_sentence: '',
    translation: '',
  });
  const [stats, setStats] = useState({
    reviewed: 0,
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
    cyclesCompleted: 0,
  });
  const [completedInBlock, setCompletedInBlock] = useState(0);

  const practiceGroups = useMemo(
    () => buildPracticeGroups(studyOrder, selectedLevel),
    [studyOrder, selectedLevel],
  );
  const currentCard = queue[0] || null;
  const currentBlockCards = useMemo(
    () => practiceGroups[activeGroupIndex]?.cards || [],
    [practiceGroups, activeGroupIndex],
  );

  const totalWords = allWords.length;
  const totalBlocks = practiceGroups.length;
  const currentBlockNumber = currentBlockCards.length > 0 ? activeGroupIndex + 1 : 0;
  const currentBlockLabel = practiceGroups[activeGroupIndex]?.label || '';
  const queueSize = queue.length;
  const finishedInBlock = completedInBlock;
  const reviewedInBlock = completedInBlock + queueSize;
  const applicationSentence = useMemo(() => getApplicationSentence(currentCard), [currentCard]);
  const sentenceTranslation = useMemo(() => getSentenceEnglishTranslation(currentCard), [currentCard]);
  const visibleNotes = useMemo(() => getNotesWithoutTranslation(currentCard), [currentCard]);
  const hasCurrentSentence = useMemo(
    () => Boolean(currentCard?.example_sentence && currentCard.example_sentence.trim()),
    [currentCard?.example_sentence],
  );
  const blockProgressText = currentBlockCards.length
    ? `${finishedInBlock} / ${currentBlockCards.length}`
    : '0 / 0';
  const blockOptions = useMemo(
    () => practiceGroups.map((group, index) => ({ ...group, index })),
    [practiceGroups],
  );

  function replaceWordInCollections(updatedWord) {
    const replaceItem = (word) => (word.id === updatedWord.id ? updatedWord : word);
    setAllWords((current) => current.map(replaceItem));
    setStudyOrder((current) => current.map(replaceItem));
    setQueue((current) => current.map(replaceItem));
  }

  async function fetchAllWords(level) {
    const words = [];
    let skip = 0;
    let done = false;

    while (!done) {
      const batch = await fetchWords('', FETCH_LIMIT, skip, level);
      if (!Array.isArray(batch)) {
        throw new Error('Unexpected API response format from /words.');
      }

      words.push(...batch);
      if (batch.length < FETCH_LIMIT) {
        done = true;
      } else {
        skip += batch.length;
      }
    }

    return words;
  }

  function hasExampleSentence(word) {
    return typeof word.example_sentence === 'string' && word.example_sentence.trim().length > 0;
  }

  function startStudyCycle(words, cycleMessage, resetStats = false, cycleLevel = selectedLevel) {
    const orderedWords = orderWordsForLevel(words, cycleLevel);
    const groups = buildPracticeGroups(orderedWords, cycleLevel);
    const firstGroupCards = groups[0]?.cards || [];

    setStudyOrder(orderedWords);
    setActiveGroupIndex(0);
    setSelectedGroupIndex(0);
    setQueue(shuffleArray(firstGroupCards));
    setCompletedInBlock(0);
    setRevealed(false);
    setMessage(cycleMessage);
    if (resetStats) {
      setStats({
        reviewed: 0,
        again: 0,
        hard: 0,
        good: 0,
        easy: 0,
        cyclesCompleted: 0,
      });
    }
  }

  async function loadWords(forceNewSession = false, level = selectedLevel) {
    setLoading(true);
    setError('');

    try {
      const words = await fetchAllWords(level);
      const sessionWords = onlyWithSentence ? words.filter(hasExampleSentence) : words;
      setAllWords(sessionWords);

      if (sessionWords.length === 0) {
        setStudyOrder([]);
        setQueue([]);
        clearSavedProgress(level);
        setMessage(
          onlyWithSentence
            ? `No ${level} words with sentences found. Disable the sentence-only filter or add sentences.`
            : `No ${level} vocabulary found. Import a DOCX file to start practicing.`,
        );
      } else {
        const restored = forceNewSession ? null : readSavedProgress(sessionWords, level);

        if (restored) {
          setStudyOrder(restored.studyOrder);
          setActiveGroupIndex(restored.activeGroupIndex);
          setSelectedGroupIndex(restored.activeGroupIndex);
          setQueue(restored.queue);
          setCompletedInBlock(restored.completedInBlock);
          setRevealed(restored.revealed);
          setStats(restored.stats);
          setMessage(`Previous ${level} study progress restored.`);
        } else {
          const initialGroupCount = buildPracticeGroups(orderWordsForLevel(sessionWords, level), level).length;
          const groupLabel = level === 'B2' ? 'lesson' : 'block';
          startStudyCycle(
            sessionWords,
            `Loaded ${sessionWords.length} ${level} words. Start with ${groupLabel} 1 of ${initialGroupCount}.`,
            forceNewSession,
            level,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAllWords([]);
      setStudyOrder([]);
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWords(false, selectedLevel);
  }, [selectedLevel, onlyWithSentence]);

  function moveToNextBlockOrCycle() {
    const nextGroupIndex = activeGroupIndex + 1;

    if (nextGroupIndex < practiceGroups.length) {
      const nextGroup = practiceGroups[nextGroupIndex];
      setActiveGroupIndex(nextGroupIndex);
      setSelectedGroupIndex(nextGroupIndex);
      setQueue(shuffleArray(nextGroup.cards));
      setCompletedInBlock(0);
      setRevealed(false);
      setMessage(
        selectedLevel === 'B2'
          ? `Starting lesson ${nextGroup.label}.`
          : `Great. Starting block ${nextGroupIndex + 1} of ${practiceGroups.length}.`,
      );
      return;
    }

    setStats((current) => ({ ...current, cyclesCompleted: current.cyclesCompleted + 1 }));
    startStudyCycle(
      allWords,
      selectedLevel === 'B2'
        ? 'All lessons completed. New cycle started.'
        : 'All words completed. New shuffled cycle started for repetition.',
      false,
      selectedLevel,
    );
  }

  function markCard(result) {
    if (!currentCard) {
      return;
    }

    const cardToProcess = currentCard;
    setRevealed(false);

    setStats((current) => ({
      ...current,
      reviewed: current.reviewed + 1,
      [result]: current[result] + 1,
    }));

    setQueue((currentQueue) => {
      if (!currentQueue.length) {
        return currentQueue;
      }

      const [, ...remaining] = currentQueue;

      if (result === 'again') {
        return insertAtOffset(remaining, cardToProcess, AGAIN_OFFSET);
      }

      if (result === 'hard') {
        return insertAtOffset(remaining, cardToProcess, HARD_OFFSET);
      }

      setCompletedInBlock((current) => current + 1);
      return remaining;
    });
  }

  function skipCard() {
    if (!currentCard) {
      return;
    }

    const cardToSkip = currentCard;
    setRevealed(false);
    setQueue((currentQueue) => {
      if (currentQueue.length <= 1) {
        return currentQueue;
      }
      const [, ...remaining] = currentQueue;
      return [...remaining, cardToSkip];
    });
  }

  function resetCurrentBlock() {
    setQueue(shuffleArray(currentBlockCards));
    setCompletedInBlock(0);
    setRevealed(false);
    setMessage(
      selectedLevel === 'B2'
        ? `${currentBlockLabel || 'Lesson'} reset with repetition.`
        : `Block ${currentBlockNumber} reset with repetition.`,
    );
  }

  function jumpToBlock(groupIndex) {
    if (!practiceGroups.length) {
      return;
    }

    const normalizedIndex = Math.max(0, Math.min(groupIndex, totalBlocks - 1));
    const nextGroup = practiceGroups[normalizedIndex];

    if (!nextGroup?.cards?.length) {
      return;
    }

    setActiveGroupIndex(normalizedIndex);
    setSelectedGroupIndex(normalizedIndex);
    setQueue(shuffleArray(nextGroup.cards));
    setCompletedInBlock(0);
    setRevealed(false);
    setMessage(
      selectedLevel === 'B2'
        ? `Moved to lesson ${nextGroup.label}.`
        : `Moved to block ${normalizedIndex + 1} for focused practice.`,
    );
  }

  function startNewCycle() {
    if (!allWords.length) {
      return;
    }
    startStudyCycle(
      allWords,
      selectedLevel === 'B2'
        ? 'New lesson cycle started.'
        : 'New cycle started with all words reshuffled.',
      false,
      selectedLevel,
    );
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError('');
    setMessage('');
    try {
      const result = await importDocx(file, selectedLevel);
      const importLabel = result.lesson ? `${selectedLevel} lesson "${result.lesson}"` : selectedLevel;
      setMessage(`Import complete for ${importLabel}: ${result.imported} new words, ${result.skipped} skipped.`);
      await loadWords(true, selectedLevel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      event.target.value = '';
    }
  }

  useEffect(() => {
    if (!loading && queue.length === 0 && currentBlockCards.length > 0) {
      moveToNextBlockOrCycle();
    }
  }, [queue.length, loading, currentBlockCards.length]);

  useEffect(() => {
    if (currentBlockNumber > 0) {
      setSelectedGroupIndex(activeGroupIndex);
    }
  }, [activeGroupIndex, currentBlockNumber]);

  useEffect(() => {
    setSentenceDraft(currentCard?.example_sentence || '');
    setTranslationDraft(getSentenceEnglishTranslation(currentCard));
  }, [currentCard?.id, currentCard?.example_sentence, currentCard?.notes]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!allWords.length || !studyOrder.length) {
      return;
    }

    const payload = {
      studyOrderIds: studyOrder.map((word) => word.id),
      queueIds: queue.map((word) => word.id),
      activeGroupIndex,
      completedInBlock,
      revealed,
      stats,
    };

    window.localStorage.setItem(`${PROGRESS_STORAGE_KEY_BASE}_${selectedLevel}`, JSON.stringify(payload));
  }, [loading, allWords.length, studyOrder, queue, activeGroupIndex, completedInBlock, revealed, stats, selectedLevel]);

  async function handleSentenceSave() {
    if (!currentCard) {
      return;
    }

    setSavingSentence(true);
    setError('');

    try {
      const nextNotes = buildNotesWithTranslation(currentCard.notes, translationDraft);
      const updated = await updateWord(currentCard.id, {
        example_sentence: sentenceDraft.trim() || null,
        notes: nextNotes,
      });
      replaceWordInCollections(updated);
      setMessage(`Sentence saved for “${updated.english_word}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSentence(false);
    }
  }

  function handleManualChange(event) {
    const { name, value } = event.target;
    setManualForm((current) => ({ ...current, [name]: value }));
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    const word = manualForm.english_word.trim();
    const meaning = manualForm.meaning.trim();

    if (!word || !meaning) {
      setError('Word and meaning are required.');
      return;
    }

    setSavingManual(true);
    setError('');

    try {
      const notes = buildNotesWithTranslation(null, manualForm.translation);
      await createWord({
        english_word: word,
        level: selectedLevel,
        part_of_speech: null,
        meaning,
        example_sentence: manualForm.example_sentence.trim() || null,
        notes,
      });

      setManualForm({
        english_word: '',
        meaning: '',
        example_sentence: '',
        translation: '',
      });
      setMessage(`Word added to ${selectedLevel}.`);
      await loadWords(true, selectedLevel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingManual(false);
    }
  }

  async function copyText(value, label, key) {
    const text = String(value || '').trim();
    if (!text) {
      setError(`No ${label.toLowerCase()} to copy.`);
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement('textarea');
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setMessage(`${label} copied.`);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? '' : current));
      }, 1200);
    } catch {
      setError(`Could not copy ${label.toLowerCase()}.`);
    }
  }

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">{selectedLevel} Builder</p>
          <h1>{selectedLevel} Builder</h1>
          <p className="subtitle">Flashcard memorization for {selectedLevel} vocabulary.</p>
        </div>

        <div className="hero-stats">
          <div className="hero-card">
            <span>Level</span>
            <strong>{selectedLevel}</strong>
          </div>
          <div className="hero-card">
            <span>Total words</span>
            <strong>{totalWords}</strong>
          </div>
          <div className="hero-card">
            <span>{selectedLevel === 'B2' ? 'Total lessons' : 'Total blocks'}</span>
            <strong>{totalBlocks}</strong>
          </div>
          <div className="hero-card">
            <span>{selectedLevel === 'B2' ? 'Current lesson' : 'Current block'}</span>
            <strong>{currentBlockLabel || currentBlockNumber || '-'}</strong>
          </div>
          <div className="hero-card">
            <span>{selectedLevel === 'B2' ? 'Lesson progress' : 'Block progress'}</span>
            <strong>{blockProgressText}</strong>
          </div>
          <div className="hero-card">
            <span>Cards in queue</span>
            <strong>{queueSize}</strong>
          </div>
          <div className="hero-card">
            <span>Cycles done</span>
            <strong>{stats.cyclesCompleted}</strong>
          </div>
        </div>
      </header>

      <main className="flash-layout">
        <section className="panel controls-panel">
          <h2>Study dashboard</h2>

          <div className="block-picker">
            <label htmlFor="level-select">Vocabulary level</label>
            <div className="block-picker-row">
              <select
                id="level-select"
                value={selectedLevel}
                onChange={(event) => {
                  const nextLevel = event.target.value;
                  setSelectedLevel(nextLevel);
                  setOnlyWithSentence(nextLevel === 'B2');
                }}
                disabled={loading}
              >
                <option value="B1">B1</option>
                <option value="B2">B2</option>
              </select>
              <button type="button" onClick={() => loadWords(false, selectedLevel)} disabled={loading}>
                Load
              </button>
            </div>
            <div className="sentence-filter-row">
              <input
                id="sentence-only"
                type="checkbox"
                checked={onlyWithSentence}
                onChange={(event) => setOnlyWithSentence(event.target.checked)}
              />
              <label htmlFor="sentence-only">Only cards with sentence</label>
            </div>
          </div>

          <div className="stat-grid">
            <div className="mini-stat">
              <span>Reviewed</span>
              <strong>{stats.reviewed}</strong>
            </div>
            <div className="mini-stat">
              <span>Again</span>
              <strong>{stats.again}</strong>
            </div>
            <div className="mini-stat">
              <span>Hard</span>
              <strong>{stats.hard}</strong>
            </div>
            <div className="mini-stat">
              <span>Good</span>
              <strong>{stats.good}</strong>
            </div>
            <div className="mini-stat">
              <span>Easy</span>
              <strong>{stats.easy}</strong>
            </div>
            <div className="mini-stat">
              <span>In block</span>
              <strong>{reviewedInBlock}</strong>
            </div>
          </div>

          <div className="control-grid">
            <button type="button" onClick={startNewCycle} disabled={loading || totalWords === 0}>
              New full cycle
            </button>
            <button type="button" onClick={resetCurrentBlock} disabled={loading || currentBlockCards.length === 0}>
              Reset current block
            </button>
            <button type="button" onClick={skipCard} disabled={loading || queue.length < 2}>
              Skip card
            </button>
            <button type="button" onClick={() => setRevealed((current) => !current)} disabled={loading || !currentCard}>
              {revealed ? 'Hide answer' : 'Reveal answer'}
            </button>
          </div>

          <div className="block-picker">
            <label htmlFor="block-select">{selectedLevel === 'B2' ? 'Practice lesson' : 'Practice favorite block'}</label>
            <div className="block-picker-row">
              <select
                id="block-select"
                value={selectedGroupIndex}
                onChange={(event) => setSelectedGroupIndex(Number(event.target.value))}
                disabled={loading || totalBlocks === 0}
              >
                {blockOptions.map((group) => (
                  <option key={group.key} value={group.index}>
                    {group.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => jumpToBlock(selectedGroupIndex)}
                disabled={loading || totalBlocks === 0}
              >
                Go
              </button>
            </div>
          </div>

          <div className="import-box">
            <div className="entry-toggle">
              <button
                type="button"
                className={entryMode === 'import' ? 'entry-tab active' : 'entry-tab'}
                onClick={() => setEntryMode('import')}
              >
                Import DOCX
              </button>
              <button
                type="button"
                className={entryMode === 'manual' ? 'entry-tab active' : 'entry-tab'}
                onClick={() => setEntryMode('manual')}
              >
                Add Manually
              </button>
            </div>

            {entryMode === 'import' ? (
              <>
                <label htmlFor="docx-upload">Import DOCX vocabulary</label>
                <input id="docx-upload" type="file" accept=".docx" onChange={handleImport} />
                <small>Imports into selected level: {selectedLevel}. After import, this level reloads and restarts.</small>
              </>
            ) : (
              <form className="manual-form" onSubmit={handleManualSubmit}>
                <label htmlFor="manual-word">Word</label>
                <input
                  id="manual-word"
                  name="english_word"
                  value={manualForm.english_word}
                  onChange={handleManualChange}
                  placeholder="German word"
                  required
                />

                <label htmlFor="manual-meaning">Meaning</label>
                <input
                  id="manual-meaning"
                  name="meaning"
                  value={manualForm.meaning}
                  onChange={handleManualChange}
                  placeholder="English meaning"
                  required
                />

                <label htmlFor="manual-sentence">Example sentence (German)</label>
                <textarea
                  id="manual-sentence"
                  name="example_sentence"
                  rows="3"
                  value={manualForm.example_sentence}
                  onChange={handleManualChange}
                  placeholder="Optional German example sentence"
                />

                <label htmlFor="manual-translation">Sentence translation (English)</label>
                <textarea
                  id="manual-translation"
                  name="translation"
                  rows="2"
                  value={manualForm.translation}
                  onChange={handleManualChange}
                  placeholder="Optional English translation"
                />

                <button type="submit" disabled={savingManual}>
                  {savingManual ? 'Saving…' : `Add to ${selectedLevel}`}
                </button>
              </form>
            )}
          </div>

          {message ? <p className="status success">{message}</p> : null}
          {error ? <p className="status error">{error}</p> : null}
        </section>

        <section className="panel trainer-panel">
          <div className="trainer-header">
            <h2>Flashcard trainer</h2>
            {currentCard ? <span>{currentBlockLabel || `Block ${currentBlockNumber}`} • Queue {queueSize}</span> : null}
          </div>

          {loading ? <p className="empty-state">Loading vocabulary…</p> : null}
          {!loading && !currentCard ? <p className="empty-state">No cards available yet.</p> : null}

          {!loading && currentCard ? (
            <>
              <div className="flashcard-shell">
                <div
                  key={currentCard.id}
                  className={`flashcard ${revealed ? 'revealed' : ''}`}
                  onClick={() => setRevealed((current) => !current)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setRevealed((current) => !current);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {!revealed ? (
                    <div className="flashcard-face front-face">
                      <div className="face-content-card">
                        <p className="card-label">German word</p>
                        <h3 className="word-title">{currentCard.english_word}</h3>
                        <div className="copy-actions">
                          <button
                            type="button"
                            className={`copy-btn ${copiedKey === `word-${currentCard.id}` ? 'copied' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              copyText(currentCard.english_word, 'Word', `word-${currentCard.id}`);
                            }}
                          >
                            {copiedKey === `word-${currentCard.id}` ? '✓ Copied' : 'Copy word'}
                          </button>
                        </div>
                        {currentCard.part_of_speech ? <p className="card-meta">{currentCard.part_of_speech}</p> : null}
                        <p className="card-hint">Click card to reveal meaning and sentence</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flashcard-face back-face">
                      <div className="face-content-card">
                        <p className="card-label">English meaning</p>
                        <h3>{currentCard.meaning}</h3>
                        <p className="card-label secondary">Application sentence</p>
                        <p className="card-example">{applicationSentence}</p>
                        {sentenceTranslation ? (
                          <p className="card-translation"><strong>Translation (EN):</strong> {sentenceTranslation}</p>
                        ) : null}
                        <div className="copy-actions">
                          <button
                            type="button"
                            className={`copy-btn ${copiedKey === `meaning-${currentCard.id}` ? 'copied' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              copyText(currentCard.meaning, 'Meaning', `meaning-${currentCard.id}`);
                            }}
                          >
                            {copiedKey === `meaning-${currentCard.id}` ? '✓ Copied' : 'Copy meaning'}
                          </button>
                          <button
                            type="button"
                            className={`copy-btn ${copiedKey === `sentence-${currentCard.id}` ? 'copied' : ''}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              copyText(applicationSentence, 'Sentence', `sentence-${currentCard.id}`);
                            }}
                          >
                            {copiedKey === `sentence-${currentCard.id}` ? '✓ Copied' : 'Copy sentence'}
                          </button>
                        </div>
                        {!hasCurrentSentence ? (
                          <div className="sentence-editor">
                            <label htmlFor="sentence-editor">Add German example sentence</label>
                            <textarea
                              id="sentence-editor"
                              rows="4"
                              value={sentenceDraft}
                              onChange={(event) => setSentenceDraft(event.target.value)}
                              placeholder="Write a short German sentence for this word"
                            />
                            <label htmlFor="translation-editor">Add English translation</label>
                            <textarea
                              id="translation-editor"
                              rows="3"
                              value={translationDraft}
                              onChange={(event) => setTranslationDraft(event.target.value)}
                              placeholder="Write the English translation of your sentence"
                            />
                            <button type="button" onClick={handleSentenceSave} disabled={savingSentence}>
                              {savingSentence ? 'Saving…' : 'Save sentence'}
                            </button>
                          </div>
                        ) : null}
                        {visibleNotes ? <p className="card-notes">{visibleNotes}</p> : null}
                        <p className="card-hint">Choose rating below to move forward</p>
                      </div>
                    </div>
                  )}
                  </div>
              </div>

              <div className="rating-grid">
                <button type="button" className="rate-again" onClick={() => markCard('again')}>
                  Again
                </button>
                <button type="button" className="rate-hard" onClick={() => markCard('hard')}>
                  Hard
                </button>
                <button type="button" className="rate-good" onClick={() => markCard('good')}>
                  Good
                </button>
                <button type="button" className="rate-easy" onClick={() => markCard('easy')}>
                  Easy
                </button>
              </div>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
