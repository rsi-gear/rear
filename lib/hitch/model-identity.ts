import type { ModelIdentityV1 } from "../hitch-types";

function normalizedProvider(provider: string | undefined): string | undefined {
  const normalized = provider?.replace(/^\/+|\/+$/g, "");
  return normalized || undefined;
}

export function normalizedEffectiveModelId(model: ModelIdentityV1): string {
  const provider = normalizedProvider(model.provider);
  let effective = model.effective_id.replace(/^\/+/, "");
  if (provider) {
    while (effective.startsWith(`${provider}/`)) {
      effective = effective.slice(provider.length + 1);
    }
  }
  return effective;
}

export function effectiveModelIdentity(model: ModelIdentityV1) {
  return {
    provider: normalizedProvider(model.provider),
    effective_id: normalizedEffectiveModelId(model),
    parameters_sha256: model.parameters_sha256,
    identity_resolved: model.identity_resolved,
  };
}

export function modelIdentityLabel(
  model: ModelIdentityV1,
  { includeParameters = false }: { includeParameters?: boolean } = {},
): string {
  const provider = normalizedProvider(model.provider) || "";
  const effective = normalizedEffectiveModelId(model);
  const qualified = provider && effective !== provider ? `${provider}/${effective}` : effective;
  const parameters = includeParameters && model.parameters_sha256
    ? ` · params ${model.parameters_sha256.slice(7, 15)}`
    : "";
  const unresolved = model.identity_resolved === true ? "" : " · unresolved";
  return `${qualified}${parameters}${unresolved}`;
}
