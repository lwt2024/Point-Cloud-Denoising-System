export function parseSshCommand(command: string) {
  const tokens = command.trim().split(/\s+/);
  if (tokens.shift() !== "ssh")
    throw new Error("请粘贴以 ssh 开头的 AutoDL 登录命令");
  let port = 22;
  let username = "root";
  let destination = "";
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "-p" || /^-p\d+$/.test(token)) {
      const value = token === "-p" ? tokens[++index] : token.slice(2);
      if (!/^\d+$/.test(value || "")) throw new Error("SSH 端口需要是数字");
      port = Number(value);
    } else if (token === "-l") username = tokens[++index] || "";
    else if (token.startsWith("-") || destination)
      throw new Error(
        "仅支持 ssh [-p 端口] [用户名@]主机，不支持附加选项或远端命令",
      );
    else destination = token;
  }
  if (destination.split("@").length > 2)
    throw new Error("SSH 主机或用户名无效");
  if (destination.includes("@"))
    [username, destination] = destination.split("@");
  const host = destination.replace(/^\[([^\]]+)\]$/, "$1");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(host) ||
    !/^[A-Za-z0-9_.-]+$/.test(username)
  )
    throw new Error("SSH 主机或用户名无效");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SSH 端口范围为 1–65535");
  return { host, port, username };
}
