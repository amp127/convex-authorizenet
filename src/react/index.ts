"use client";

/**
 * POST an Accept Hosted token to Authorize.net.
 * Accept Hosted does not provide a URL that can be opened with a redirect.
 */
export function submitHostedForm(args: { token: string; formUrl: string }) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = args.formUrl;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "token";
  input.value = args.token;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
