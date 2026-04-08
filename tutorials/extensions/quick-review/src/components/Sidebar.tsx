import { useTutorial } from '../context/TutorialContext';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { chapters, currentChapter, setCurrentChapter, progress } = useTutorial();

  const handleChapterClick = (chapterId: string) => {
    setCurrentChapter(chapterId);
    if (window.innerWidth <= 768) {
      onClose();
    }
  };

  return (
    <>
      <div 
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`} 
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="Chapter navigation">
        <div className="sidebar-header">
          <h1 className="sidebar-title">quick-review</h1>
          <p className="sidebar-subtitle">Tutorial Navigation</p>
        </div>
        
        <nav className="chapter-list" aria-label="Chapters">
          {chapters.map((chapter, index) => (
            <button
              key={chapter.id}
              className={`chapter-item ${currentChapter === chapter.id ? 'active' : ''} ${chapter.completed ? 'completed' : ''}`}
              onClick={() => handleChapterClick(chapter.id)}
              aria-current={currentChapter === chapter.id ? 'page' : undefined}
            >
              <span className="chapter-number">
                {chapter.completed ? '✓' : index + 1}
              </span>
              <span className="chapter-info">
                <span className="chapter-title">{chapter.title}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="progress-text">
            {Math.round(progress)}% Complete
          </p>
        </div>
      </aside>
    </>
  );
}
