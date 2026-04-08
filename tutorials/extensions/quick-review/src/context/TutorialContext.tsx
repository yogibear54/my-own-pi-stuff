import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface TutorialChapter {
  id: string;
  title: string;
  completed: boolean;
}

interface TutorialContextType {
  currentChapter: string;
  setCurrentChapter: (id: string) => void;
  chapters: TutorialChapter[];
  markChapterComplete: (id: string) => void;
  progress: number;
  getNextChapter: () => TutorialChapter | null;
  getPrevChapter: () => TutorialChapter | null;
}

const STORAGE_KEY = 'quick-review-tutorial-progress';

const defaultChapters: TutorialChapter[] = [
  { id: 'architecture-overview', title: 'Architecture Overview', completed: false },
  { id: 'key-modules', title: 'Key Modules', completed: false },
  { id: 'data-flow', title: 'Data Flow', completed: false },
  { id: 'typescript-patterns', title: 'TypeScript Patterns', completed: false },
  { id: 'configuration-entry', title: 'Configuration & Entry Points', completed: false },
];

const TutorialContext = createContext<TutorialContextType | null>(null);

export function TutorialProvider({ children }: { children: ReactNode }) {
  const [chapters, setChapters] = useState<TutorialChapter[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Merge stored progress with default chapters
        return defaultChapters.map(ch => {
          const storedCh = parsed.find((s: TutorialChapter) => s.id === ch.id);
          return storedCh ? { ...ch, completed: storedCh.completed } : ch;
        });
      } catch {
        return defaultChapters;
      }
    }
    return defaultChapters;
  });

  const [currentChapter, setCurrentChapterState] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_KEY + '-current');
    return stored || 'architecture-overview';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chapters));
  }, [chapters]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY + '-current', currentChapter);
  }, [currentChapter]);

  const setCurrentChapter = (id: string) => {
    setCurrentChapterState(id);
  };

  const markChapterComplete = (id: string) => {
    setChapters(prev => prev.map(ch => 
      ch.id === id ? { ...ch, completed: true } : ch
    ));
  };

  const progress = (chapters.filter(ch => ch.completed).length / chapters.length) * 100;

  const getNextChapter = () => {
    const idx = chapters.findIndex(ch => ch.id === currentChapter);
    return idx < chapters.length - 1 ? chapters[idx + 1] : null;
  };

  const getPrevChapter = () => {
    const idx = chapters.findIndex(ch => ch.id === currentChapter);
    return idx > 0 ? chapters[idx - 1] : null;
  };

  return (
    <TutorialContext.Provider value={{
      currentChapter,
      setCurrentChapter,
      chapters,
      markChapterComplete,
      progress,
      getNextChapter,
      getPrevChapter,
    }}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error('useTutorial must be used within TutorialProvider');
  }
  return context;
}
