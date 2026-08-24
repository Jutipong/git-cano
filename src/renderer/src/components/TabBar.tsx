import { FolderGit2, Plus, X } from 'lucide-react'

interface Tab {
  path: string
  name: string
}

interface Props {
  tabs: Tab[]
  activeIndex: number
  onSelect: (index: number) => void
  onClose: (index: number) => void
  onOpenNew: () => void
}

export default function TabBar({ tabs, activeIndex, onSelect, onClose, onOpenNew }: Props) {
  if (tabs.length === 0) return null
  return (
    <div className="tab-bar">
      {tabs.map((tab, index) => (
        <div
          key={tab.path}
          className={`repo-tab${index === activeIndex ? ' active' : ''}`}
          title={tab.path}
          onClick={() => onSelect(index)}
        >
          <FolderGit2 size={13} />
          <span>{tab.name}</span>
          <button
            className="icon-btn tab-close"
            title={`Close ${tab.name}`}
            onClick={(event) => {
              event.stopPropagation()
              onClose(index)
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button className="icon-btn tab-new" title="Open another repository" onClick={onOpenNew}>
        <Plus size={15} />
      </button>
    </div>
  )
}
