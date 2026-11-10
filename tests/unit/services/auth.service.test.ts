import { AuthService, InvalidCredentialsError } from "@/server/services/auth.service";
import { hashPassword } from "@/server/services/password.service";
import { FakeUserRepository } from "../../setup/fake-user.repository";

describe("AuthService.authenticate", () => {
  let repo: FakeUserRepository;
  let service: AuthService;

  beforeEach(async () => {
    repo = new FakeUserRepository();
    service = new AuthService(repo);
    await repo.create({
      name: "Admin",
      email: "admin@elevateone.local",
      passwordHash: await hashPassword("Admin@123"),
      role: "ADMIN",
    });
  });

  it("retorna o usuário público e a sessão com credenciais válidas", async () => {
    const result = await service.authenticate("Admin@ElevateOne.local", "Admin@123");
    expect(result.user).toMatchObject({ email: "admin@elevateone.local", role: "ADMIN" });
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.session).toEqual({
      userId: result.user.id,
      name: "Admin",
      email: "admin@elevateone.local",
      role: "ADMIN",
    });
  });

  it("falha com senha incorreta", async () => {
    await expect(service.authenticate("admin@elevateone.local", "errada")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it("falha com usuário inexistente (mesmo erro genérico)", async () => {
    await expect(service.authenticate("ninguem@x.com", "Admin@123")).rejects.toThrow(
      "E-mail ou senha inválidos",
    );
  });

  it("falha com usuário inativo (mesmo erro genérico)", async () => {
    repo.users[0].active = false;
    await expect(
      service.authenticate("admin@elevateone.local", "Admin@123"),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("AuthService.getActiveUser", () => {
  it("retorna o usuário ativo e null para inativo/inexistente", async () => {
    const repo = new FakeUserRepository();
    const service = new AuthService(repo);
    const user = await repo.create({ name: "U", email: "u@u.com", passwordHash: "h" });
    await expect(service.getActiveUser(user.id)).resolves.toMatchObject({ id: user.id });
    user.active = false;
    await expect(service.getActiveUser(user.id)).resolves.toBeNull();
    await expect(service.getActiveUser("nope")).resolves.toBeNull();
  });
});
