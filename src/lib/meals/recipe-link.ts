export function recipeLinkLabel(source: string | null | undefined): string {
  return source?.trim().toLowerCase() === 'emeals' ? 'Open in eMeals' : 'View recipe';
}
