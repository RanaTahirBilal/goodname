import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * The notice, as one component rather than twelve copies of a div.
 *
 * There were twelve `<div className="notice notice-warning">` in the app,
 * each assembling its own markup, and only the ones somebody remembered had
 * a leading glyph. That is how a tone ends up carried by colour alone, which
 * is the accessibility failure that costs nothing to avoid and is invisible
 * to the person who introduced it.
 *
 * ## Why the icon is chosen by tone and not by the caller
 *
 * Because a caller picking a glyph per notice is how two notices saying the
 * same kind of thing end up looking like different kinds of thing. The tone
 * is the meaning; the glyph follows from it. A caller can override for the
 * cases where the subject genuinely is the icon, which in this product is
 * retention (a clock) and refusal (a padlock), and those are spelled out
 * below rather than left to taste.
 *
 * ## Three channels, deliberately
 *
 * Tone reaches the reader as colour, as a word in the title, and as a shape.
 * Any one of the three can fail somebody: colour for about one man in
 * twelve, the title for anybody skimming, the shape for a screen reader,
 * which is why the icon is hidden from it and the title is not.
 */

export type Tone = 'info' | 'warning' | 'danger' | 'success';

const TONE_ICON: Record<Tone, IconName> = {
  info: 'eye',
  warning: 'alert',
  danger: 'alert',
  success: 'check',
};

export interface NoticeProps {
  tone?: Tone;
  /** Bold first line. Optional, because some notices are a single sentence. */
  title?: ReactNode;
  children?: ReactNode;
  /**
   * For the two cases where the subject is the icon rather than the tone:
   * `clock` for anything on a retention or grace-period clock, `lock` for a
   * refusal. Anything else should be using the tone's own glyph.
   */
  icon?: IconName;
  className?: string;
  style?: React.CSSProperties;
  role?: 'status' | 'alert';
}

export function Notice({
  tone = 'info',
  title,
  children,
  icon,
  className,
  style,
  role,
}: NoticeProps) {
  return (
    <div className={`notice notice-${tone}${className ? ` ${className}` : ''}`} style={style} role={role}>
      {/*
        Decoration, and so silent. The tone is already in the title and in
        the words; an icon announcing "warning" before them would make a
        screen reader say it twice.
      */}
      <Icon name={icon ?? TONE_ICON[tone]} scale={1.1} />
      <div>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}
