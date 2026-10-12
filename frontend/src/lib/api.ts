/* QUESTIONS */
// am I supposed to make an ApiError class???

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let url, result;
  // Checks if in browser or server
  if (typeof window === "undefined") {
    url = `${process.env.BACKEND_URL}${path}`;
  } else {
    url = path;
  }

  const response = await fetch(url, init);

  if (response.status == 204) {
    return undefined as T;
  }

  if (!response.ok) {
    // default fallback values for code/detail
    let code = "code_erorr";
    let detail = response.statusText || "Request failed";

    try {
      result = await response.json();
      code = result.code ?? code;
      detail = result.detail ?? detail;
    } catch {}
    throw new ApiError(response.status, code, detail);
  }

  return result as T;
}

export class ApiError extends Error {
  status: number;
  code: string;
  detail: string;

  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}
