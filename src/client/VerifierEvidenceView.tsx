import type { RefinementRunView } from '../types.ts'
import type { RefinementKey } from './locales.ts'

/** Public, validated score evidence; phase scores belong to the whole trial. */
export function VerifierEvidenceView({ run, t }: { readonly run: RefinementRunView; readonly t: (key: RefinementKey) => string }) {
  const evidence = run.verifier
  if (!evidence) return null
  return <details className="rear-refinement-verifier-evidence">
    <summary>{t('score.details')} · {t('score.total')} {evidence.scores.total_score.toFixed(3)}
      {evidence.scores.process_score !== undefined && <> · {t('score.process')} {evidence.scores.process_score.toFixed(3)}</>}
    </summary>
    {evidence.process && <div>
      <p>{evidence.process.metric} · {evidence.process.score.toFixed(3)}
        {evidence.process.total !== undefined && <> · {evidence.process.passed}/{evidence.process.total}</>}
      </p>
      {evidence.process.components && <ul aria-label={t('score.components')}>{evidence.process.components.map(component => (
        <li key={component.id}>{component.category} · {component.status} · {component.weight}</li>
      ))}</ul>}
    </div>}
    {evidence.feedback && <ul aria-label={t('score.feedback')}>{evidence.feedback.items.map((item, index) => (
      <li key={`${item.code}:${index}`} data-severity={item.severity}>{item.message}</li>
    ))}</ul>}
  </details>
}
