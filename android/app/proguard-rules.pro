# Nothing here relies on reflection: the wire layer is hand-written (no @Serializable,
# no Gson, no Room codegen), so R8 has no model classes to keep. Empty on purpose —
# a speculative -keep is how a shrunk build silently stops parsing responses.
