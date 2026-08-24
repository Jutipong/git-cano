export interface FileNode {
    /** directory segment or file basename */
    name: string
    /** full path (prefix for directories) */
    path: string
    isDir: boolean
    children: FileNode[]
}

export interface TreeRow {
    key: string
    kind: 'dir' | 'file'
    name: string
    /** directory prefix (dirs) or full file path (files) */
    fullPath: string
    depth: number
    /** number of files beneath a directory */
    count?: number
}

/** Build a nested directory tree from a flat list of file paths. */
export function buildTree(paths: string[]): FileNode[] {
    const root: FileNode = { name: '', path: '', isDir: true, children: [] }
    for (const path of paths) {
        // renames arrive as "old -> new"; keep them as a single leaf
        if (path.includes(' → ')) {
            root.children.push({ name: path, path, isDir: false, children: [] })
            continue
        }
        const parts = path.split('/')
        let node = root
        for (let i = 0; i < parts.length - 1; i++) {
            const dirPath = parts.slice(0, i + 1).join('/')
            let child = node.children.find(c => c.isDir && c.path === dirPath)
            if (!child) {
                child = { name: parts[i], path: dirPath, isDir: true, children: [] }
                node.children.push(child)
            }
            node = child
        }
        node.children.push({
            name: parts[parts.length - 1],
            path,
            isDir: false,
            children: [],
        })
    }
    sortNodes(root.children)
    return root.children
}

function sortNodes(nodes: FileNode[]) {
    nodes.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    for (const node of nodes) if (node.isDir) sortNodes(node.children)
}

/** Flatten a tree into visible rows, skipping directories inside `collapsed`. */
export function flattenTree(
    nodes: FileNode[],
    collapsed: ReadonlySet<string>,
    keyPrefix = '',
    depth = 0
): TreeRow[] {
    const rows: TreeRow[] = []
    for (const node of nodes) {
        if (node.isDir) {
            rows.push({
                key: `${keyPrefix}dir:${node.path}`,
                kind: 'dir',
                name: node.name,
                fullPath: node.path,
                depth,
                count: countFiles(node),
            })
            if (!collapsed.has(node.path)) {
                rows.push(...flattenTree(node.children, collapsed, keyPrefix, depth + 1))
            }
        } else {
            rows.push({
                key: `${keyPrefix}${node.path}`,
                kind: 'file',
                name: node.name,
                fullPath: node.path,
                depth,
            })
        }
    }
    return rows
}

function countFiles(node: FileNode): number {
    let total = 0
    for (const child of node.children) {
        total += child.isDir ? countFiles(child) : 1
    }
    return total
}
