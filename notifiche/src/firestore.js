// Client Firestore minimo via REST (niente firebase-admin, niente npm install).

/** Valore JS -> valore Firestore. Le date (oggetti Date) diventano timestamp. */
export function codifica(valore) {
  if (valore === null || valore === undefined) return { nullValue: null };
  if (valore instanceof Date) return { timestampValue: valore.toISOString() };
  if (Array.isArray(valore)) return { arrayValue: { values: valore.map(codifica) } };
  switch (typeof valore) {
    case 'boolean': return { booleanValue: valore };
    case 'number': return Number.isInteger(valore) ? { integerValue: String(valore) } : { doubleValue: valore };
    case 'string': return { stringValue: valore };
    case 'object': return { mapValue: { fields: codificaCampi(valore) } };
    default: throw new Error(`Tipo non gestito: ${typeof valore}`);
  }
}
export function codificaCampi(oggetto) {
  const campi = {};
  for (const [chiave, valore] of Object.entries(oggetto)) {
    if (valore === undefined) continue;
    campi[chiave] = codifica(valore);
  }
  return campi;
}
/** Valore Firestore -> valore JS. I timestamp tornano come stringhe ISO. */
export function decodifica(v) {
  if (!v || 'nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).toISOString();
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decodifica);
  if ('mapValue' in v) return decodificaCampi(v.mapValue.fields ?? {});
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}
export function decodificaCampi(campi = {}) {
  return Object.fromEntries(Object.entries(campi).map(([k, v]) => [k, decodifica(v)]));
}

/** Da "projects/p/databases/(default)/documents/users/abc/studyGoals/istruttore" → ["users","abc","studyGoals","istruttore"] */
export function segmentiPercorso(nome) {
  const i = nome.indexOf('/documents/');
  return i >= 0 ? nome.slice(i + '/documents/'.length).split('/') : nome.split('/');
}

export function creaFirestore(chiamaGoogle, progetto) {
  const radice = `projects/${progetto}/databases/(default)/documents`;
  const base = `https://firestore.googleapis.com/v1/${radice}`;

  async function interroga(structuredQuery) {
    const righe = await chiamaGoogle(`${base}:runQuery`, { method: 'POST', body: { structuredQuery } });
    return (Array.isArray(righe) ? righe : [])
      .filter((r) => r.document)
      .map((r) => ({ nome: r.document.name, percorso: segmentiPercorso(r.document.name), dati: decodificaCampi(r.document.fields) }));
  }

  return {
    async leggi(percorso) {
      const doc = await chiamaGoogle(`${base}/${percorso}`, { consenti404: true });
      return doc ? decodificaCampi(doc.fields) : null;
    },
    /** Scrive solo i campi indicati (percorsi con il punto, es. "push.tokens"). */
    async aggiornaCampi(percorso, dati, campi) {
      const maschera = campi.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
      await chiamaGoogle(`${base}/${percorso}?${maschera}`, { method: 'PATCH', body: { fields: codificaCampi(dati) } });
    },
    async scrivi(percorso, dati) {
      await chiamaGoogle(`${base}/${percorso}`, { method: 'PATCH', body: { fields: codificaCampi(dati) } });
    },
    /** Tutti i documenti di una collezione (o di tutte le sottocollezioni con quel nome), con campi scelti. */
    async tutti(collezione, { gruppo = false, campi = null, dove = null, limite = null } = {}) {
      const q = { from: [{ collectionId: collezione, allDescendants: gruppo }] };
      if (campi) q.select = { fields: campi.map((fieldPath) => ({ fieldPath })) };
      if (dove) q.where = { fieldFilter: { field: { fieldPath: dove[0] }, op: dove[1], value: codifica(dove[2]) } };
      if (limite) q.limit = limite;
      return interroga(q);
    }
  };
}
