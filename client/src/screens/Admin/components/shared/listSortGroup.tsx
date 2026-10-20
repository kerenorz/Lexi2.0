// Sort/group/search controls and helpers shared by the Experiments and Agents admin lists.
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { FormControl, IconButton, InputAdornment, InputLabel, MenuItem, Select, TextField } from '@mui/material';
import React from 'react';

export type SortMode = 'newest' | 'mostUsed' | 'users';

// Muted so owner bars never read as status colors.
const OWNER_PALETTE = [
    '#9aa7b8', // slate
    '#a8b89a', // sage
    '#b89a9a', // dusty rose
    '#9ab8b2', // teal-gray
    '#b2a89a', // taupe
    '#a99ab8', // muted lavender
    '#b89ab0', // mauve
    '#9ab0b8', // steel
];

// Deterministic owner -> color via a string hash, stable across reloads.
export const ownerColor = (username?: string): string => {
    const name = username && username.length ? username : 'unknown';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return OWNER_PALETTE[Math.abs(hash) % OWNER_PALETTE.length];
};

const byNewest = <T,>(getTime: (item: T) => number) => (a: T, b: T) => (getTime(b) || 0) - (getTime(a) || 0);

// Flat-mode sort; 'users' is handled by groupByOwner. Returns a new array.
export const sortItems = <T,>(
    items: T[],
    mode: SortMode,
    getUsage: (item: T) => number,
    getTime: (item: T) => number,
): T[] => {
    const arr = [...items];
    if (mode === 'mostUsed') {
        return arr.sort((a, b) => getUsage(b) - getUsage(a) || (getTime(b) || 0) - (getTime(a) || 0));
    }
    return arr.sort(byNewest(getTime));
};

// Groups ordered by their newest item; items newest-first within each group.
export const groupByOwner = <T,>(
    items: T[],
    getOwner: (item: T) => string,
    getTime: (item: T) => number,
): { owner: string; items: T[] }[] => {
    const newest = sortItems(items, 'newest', () => 0, getTime);
    const groups = new Map<string, T[]>();
    for (const item of newest) {
        const owner = getOwner(item) || 'Unknown';
        if (!groups.has(owner)) groups.set(owner, []);
        groups.get(owner).push(item);
    }
    return Array.from(groups.entries()).map(([owner, groupItems]) => ({ owner, items: groupItems }));
};

// Case-insensitive substring filter. indexOf, not includes: the client targets es5.
export const filterByText = <T,>(items: T[], query: string, getFields: (item: T) => (string | undefined)[]): T[] => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
        const haystack = getFields(item).filter(Boolean).join(' ').toLowerCase();
        return haystack.indexOf(q) !== -1;
    });
};

interface ListSearchControlProps {
    value: string;
    onChange: (query: string) => void;
    placeholder?: string;
}

export const ListSearchControl: React.FC<ListSearchControlProps> = ({ value, onChange, placeholder }) => (
    <TextField
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Search by name…'}
        sx={{ minWidth: 220 }}
        inputProps={{ 'aria-label': placeholder || 'Search by name' }}
        InputProps={{
            startAdornment: (
                <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="disabled" />
                </InputAdornment>
            ),
            endAdornment: value ? (
                <InputAdornment position="end">
                    <IconButton size="small" aria-label="Clear search" onClick={() => onChange('')}>
                        <ClearIcon fontSize="small" />
                    </IconButton>
                </InputAdornment>
            ) : null,
        }}
    />
);

interface ListSortControlProps {
    value: SortMode;
    onChange: (mode: SortMode) => void;
    // 'Users' grouping is admin-only.
    showUsers: boolean;
}

export const ListSortControl: React.FC<ListSortControlProps> = ({ value, onChange, showUsers }) => (
    <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="list-sort-group-label">Sort / Group by</InputLabel>
        <Select
            labelId="list-sort-group-label"
            label="Sort / Group by"
            value={value}
            onChange={(e) => onChange(e.target.value as SortMode)}
        >
            <MenuItem value="newest">Newest</MenuItem>
            <MenuItem value="mostUsed">Most used</MenuItem>
            {showUsers && <MenuItem value="users">Users</MenuItem>}
        </Select>
    </FormControl>
);
