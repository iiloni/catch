export function initials(name: string, email: string) {
  const source = name.trim() || email;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

type Props = { name: string; email: string };

/** The signed-in user's avatar, name and email. */
export function AccountSummary({ name, email }: Props) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span
        aria-hidden
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground text-lg"
      >
        {initials(name, email)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium">{name || email}</p>
        {name && <p className="truncate text-muted-foreground text-sm">{email}</p>}
      </div>
    </div>
  );
}
