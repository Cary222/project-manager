/**
 * HTML Validation Utilities
 *
 * Provides validation and HTML completion for safe sandbox rendering
 */

export interface HtmlValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateHtml(html: string): HtmlValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!html || typeof html !== 'string') {
    errors.push('HTML content is empty or invalid');
    return { isValid: false, errors, warnings };
  }

  const trimmed = html.trim();

  // Check for potentially dangerous patterns
  if (/<script[\s\S]*?>[\s\S]*?<\/script>/gi.test(trimmed)) {
    warnings.push('Script tags detected - sandboxed rendering will block execution');
  }

  if (/on\w+\s*=/gi.test(trimmed)) {
    warnings.push('Inline event handlers detected - may be blocked by sandbox');
  }

  if (/javascript:/gi.test(trimmed)) {
    warnings.push('JavaScript URLs detected - may be blocked by sandbox');
  }

  // Basic structure validation
  if (trimmed.includes('<body') && !trimmed.includes('</body>')) {
    errors.push('Unclosed <body> tag');
  }

  if (trimmed.includes('<html') && !trimmed.includes('</html>')) {
    errors.push('Unclosed <html> tag');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

export function ensureCompleteHtml(html: string): string {
  if (!html || typeof html !== 'string') {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body></body></html>';
  }

  const trimmed = html.trim();

  // Already has complete HTML structure
  if (trimmed.includes('<!DOCTYPE') || (trimmed.includes('<html') && trimmed.includes('<head'))) {
    return trimmed;
  }

  // Has body tag
  if (trimmed.includes('<body')) {
    if (!trimmed.includes('<head')) {
      return trimmed.replace(/<body/i, '<head><meta charset="UTF-8"></head><body');
    }
    return trimmed;
  }

  // Wrap content in minimal HTML structure
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: system-ui, -apple-system, sans-serif;
    }
  </style>
</head>
<body>
${trimmed}
</body>
</html>`;
}
