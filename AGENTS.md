<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All crypto lives in `src/lib/crypto.ts` (WebCrypto only) so browser and Worker share one implementation of the signed message format.
- User signing private keys are generated and kept only in the browser (passphrase-wrapped in localStorage); the server stores public keys only.
- Process RSA private keys live in `process_keys`, which has no client grants; only server functions release them, and only after `closes_at`.
- Server functions verify every bid signature against the registered key before storing it and write an `audit_log` row for each security event.
