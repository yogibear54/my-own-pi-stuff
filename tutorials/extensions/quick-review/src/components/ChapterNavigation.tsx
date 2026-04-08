import { useTutorial } from '../context/TutorialContext';

interface ChapterNavigationProps {
  chapterId: string;
}

export function ChapterNavigation({ chapterId }: ChapterNavigationProps) {
  const { setCurrentChapter, getNextChapter, getPrevChapter, markChapterComplete } = useTutorial();
  
  const nextChapter = getNextChapter();
  const prevChapter = getPrevChapter();

  const handleNext = () => {
    if (nextChapter) {
      markChapterComplete(chapterId);
      setCurrentChapter(nextChapter.id);
      window.scrollTo(0, 0);
    }
  };

  const handlePrev = () => {
    if (prevChapter) {
      setCurrentChapter(prevChapter.id);
      window.scrollTo(0, 0);
    }
  };

  return (
    <nav className="chapter-nav" aria-label="Chapter navigation">
      <button 
        className="nav-button prev"
        onClick={handlePrev}
        disabled={!prevChapter}
        aria-label="Previous chapter"
      >
        <span>←</span>
        <span>Previous</span>
      </button>
      
      <button 
        className="nav-button next"
        onClick={handleNext}
        disabled={!nextChapter}
        aria-label="Next chapter"
      >
        <span>Next</span>
        <span>→</span>
      </button>
    </nav>
  );
}
