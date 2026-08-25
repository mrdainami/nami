import { verifyRegistration } from './webauthn'

export async function register(user: User) {
  const options = await createOptions(user)
  const cred = await navigator.credentials.create({ publicKey: options })
  return verifyRegistration(cred)
}
