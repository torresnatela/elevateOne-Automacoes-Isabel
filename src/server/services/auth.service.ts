import { AppError } from "@/server/lib/errors";
import { toPublicUser, type PublicUser } from "@/server/models/user.model";
import type { Session } from "@/server/models/session.model";
import type { UserRepository } from "@/server/repositories/user.repository";
import { verifyPassword } from "./password.service";

export class InvalidCredentialsError extends AppError {
  constructor() {
    super("E-mail ou senha inválidos", 401, "INVALID_CREDENTIALS");
  }
}

// Hash bcrypt de uma senha aleatória: usado para equalizar o tempo de resposta
// quando o usuário não existe (evita enumeração de e-mails por timing).
const DUMMY_HASH = "$2b$10$/AU6gS8skY6xSIGg6oW3iuX0A/KjNCLWTDOhf1QraPiT8xkuFXNea";

export class AuthService {
  constructor(private readonly users: UserRepository) {}

  async authenticate(email: string, password: string): Promise<{ user: PublicUser; session: Session }> {
    const user = await this.users.findByEmail(email);
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !user.active || !passwordOk) throw new InvalidCredentialsError();

    return {
      user: toPublicUser(user),
      session: { userId: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  async getActiveUser(id: string): Promise<PublicUser | null> {
    const user = await this.users.findById(id);
    return user && user.active ? toPublicUser(user) : null;
  }
}
