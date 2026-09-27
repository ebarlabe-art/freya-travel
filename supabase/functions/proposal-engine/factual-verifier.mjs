// Production default: generation is not evidence. No fixtures or provider imports.
export const pendingFactualVerifier = Object.freeze({
  version:'no-factual-source-v1',
  async verify({claims}) {
    return claims.map(claim=>({claim_id:claim.id,certainty:'pending_verification',evidence:[],reason:'no_authorized_source'}));
  },
});
