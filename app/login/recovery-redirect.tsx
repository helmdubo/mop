"use client";

import { useEffect } from "react";

/**
 * Ссылка восстановления пароля из письма приземляется на корень сайта
 * с токенами в #fragment (сервер их не видит). Middleware уводит на /login,
 * fragment сохраняется — отсюда пробрасываем его на страницу смены пароля.
 */
export function RecoveryRedirect() {
  useEffect(() => {
    const h = window.location.hash;
    if (h.includes("access_token") || h.includes("error_description")) {
      window.location.replace("/account/update-password" + h);
    }
  }, []);
  return null;
}
