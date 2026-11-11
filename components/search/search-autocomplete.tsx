'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Product } from '@/types';

export interface SearchSuggestion {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  category: string | null;
}

interface SearchAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Submit the current text as a search (Enter, or the "Search for …" row). */
  onSubmit: (query: string) => void;
  /** A suggestion was picked — the parent decides where it goes
      (product page or /search?q=). Defaults to onSubmit(name). */
  onSelectSuggestion?: (suggestion: SearchSuggestion) => void;
  placeholder?: string;
  inputClassName?: string;
  inputId?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}

/**
 * Search input with live suggestions (Section 10, chunk 1).
 *
 * Suggestions come from the EXISTING public products API
 * (GET /api/v1/products?search=… — the same getProducts path the
 * catalog pages use, so the health-check row is already excluded).
 * No new API route, no scraping, no invented data: when the API
 * fails or returns nothing, the dropdown simply stays closed and
 * typing/submitting still works.
 *
 * Debounced (250ms), min 2 characters, stale requests aborted.
 * Keyboard: Up/Down moves through suggestions, Enter picks the
 * highlighted one (or submits the typed text), Escape closes.
 */
export function SearchAutocomplete({
  value,
  onChange,
  onSubmit,
  onSelectSuggestion,
  placeholder = 'Search products…',
  inputClassName,
  inputId,
  ariaLabel = 'Search for products',
  autoFocus = false,
}: SearchAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = `${inputId ?? 'search-autocomplete'}-listbox`;

  // Debounced fetch: only for 2+ characters, aborted when the
  // query changes again before the request finishes.
  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) {
      abortRef.current?.abort();
      setSuggestions([]);
      setLoading(false);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      void fetch(`/api/v1/products?search=${encodeURIComponent(term)}&pageSize=6`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: unknown) => {
          if (controller.signal.aborted) return;
          const items = (data as { success?: boolean; data?: unknown })?.data;
          const products = Array.isArray(items) ? (items as Product[]) : [];
          setSuggestions(
            products.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              brand: p.brand ?? null,
              category: p.category ?? null,
            }))
          );
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch(() => {
          // Autocomplete is a convenience: a failed fetch must
          // never disturb typing or submitting.
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setOpen(false);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value]);

  // Abort any in-flight request on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const pickSuggestion = (suggestion: SearchSuggestion) => {
    setOpen(false);
    setSuggestions([]);
    if (onSelectSuggestion) {
      onSelectSuggestion(suggestion);
    } else {
      onSubmit(suggestion.name);
    }
  };

  const submitCurrent = () => {
    const term = value.trim();
    if (!term) return;
    setOpen(false);
    onSubmit(term);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        pickSuggestion(suggestions[activeIndex]);
      }
      // Otherwise the wrapping <form> submits normally.
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && activeIndex >= 0 && suggestions[activeIndex]
            ? `${listboxId}-option-${suggestions[activeIndex].id}`
            : undefined
        }
        aria-label={ariaLabel}
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Delay so a mousedown on a suggestion still lands
          // before the dropdown closes.
          window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background py-2 pl-10 pr-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          inputClassName
        )}
      />
      {open && (suggestions.length > 0 || loading) && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listboxId}-option-${suggestion.id}`}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown (not click): fires before the input's
              // blur closes the dropdown.
              onMouseDown={(e) => {
                e.preventDefault();
                pickSuggestion(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                'flex cursor-pointer flex-col rounded-sm px-3 py-2 text-sm',
                index === activeIndex && 'bg-accent text-accent-foreground'
              )}
            >
              <span className="font-medium leading-tight">{suggestion.name}</span>
              {(suggestion.brand || suggestion.category) && (
                <span className="text-xs text-muted-foreground">
                  {[suggestion.brand, suggestion.category].filter(Boolean).join(' · ')}
                </span>
              )}
            </li>
          ))}
          {loading && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
          )}
          {value.trim() && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                submitCurrent();
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm font-medium text-primary hover:bg-accent"
            >
              <Search className="h-4 w-4" />
              Search for &ldquo;{value.trim()}&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
