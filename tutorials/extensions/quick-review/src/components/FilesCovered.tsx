interface FilesCoveredProps {
  files: string[];
}

export function FilesCovered({ files }: FilesCoveredProps) {
  return (
    <div className="files-covered">
      <h3 className="files-covered-title">
        <span>📁</span>
        <span>Files Covered</span>
      </h3>
      <ul className="file-list">
        {files.map((file, index) => (
          <li key={index} className="file-item">{file}</li>
        ))}
      </ul>
    </div>
  );
}
