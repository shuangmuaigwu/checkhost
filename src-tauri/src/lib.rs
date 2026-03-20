use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command,
    str::FromStr,
    time::{SystemTime, UNIX_EPOCH},
};

const START_MARKER: &str = "# >>> CheckHosts managed block >>>";
const END_MARKER: &str = "# <<< CheckHosts managed block <<<";
const MANAGED_NOTE: &str =
    "# Managed by CheckHosts. Changes inside this block will be overwritten.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedHostEntry {
    domain: String,
    ip: String,
    label: String,
    group_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DomainState {
    domain: String,
    ip: Option<String>,
    source: DomainSource,
    duplicates: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum DomainSource {
    Managed,
    External,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostsStatus {
    host_path: String,
    block_present: bool,
    domain_states: Vec<DomainState>,
}

#[tauri::command]
fn get_hosts_status(domains: Vec<String>) -> Result<HostsStatus, String> {
    let host_path = hosts_path();
    let content =
        fs::read_to_string(&host_path).map_err(|error| format!("读取 hosts 文件失败: {error}"))?;

    Ok(build_status(&host_path, &content, &domains))
}

#[tauri::command]
fn apply_hosts(
    entries: Vec<ManagedHostEntry>,
    domains: Vec<String>,
) -> Result<HostsStatus, String> {
    let normalized_entries = normalize_entries(entries)?;
    let host_path = hosts_path();
    let original_content =
        fs::read_to_string(&host_path).map_err(|error| format!("读取 hosts 文件失败: {error}"))?;
    let next_content = build_hosts_content(&original_content, &normalized_entries);

    if next_content != original_content {
        write_hosts_file_with_admin(&host_path, &next_content)?;
    }

    let refreshed_content =
        fs::read_to_string(&host_path).map_err(|error| format!("刷新 hosts 文件失败: {error}"))?;

    Ok(build_status(&host_path, &refreshed_content, &domains))
}

fn build_status(host_path: &Path, content: &str, domains: &[String]) -> HostsStatus {
    let normalized_domains = collect_domains(domains);
    let block_present = content.contains(START_MARKER) && content.contains(END_MARKER);
    let states = resolve_domain_states(content, &normalized_domains);

    HostsStatus {
        host_path: host_path.display().to_string(),
        block_present,
        domain_states: states,
    }
}

fn normalize_entries(entries: Vec<ManagedHostEntry>) -> Result<Vec<ManagedHostEntry>, String> {
    let mut normalized = Vec::with_capacity(entries.len());
    let mut seen_domains = BTreeSet::new();

    for entry in entries {
        let domain = normalize_domain(&entry.domain)?;
        let ip = normalize_ip(&entry.ip)?;
        let label = normalize_label(&entry.label, "目标名称")?;
        let group_name = normalize_label(&entry.group_name, "分组名称")?;

        if !seen_domains.insert(domain.clone()) {
            return Err(format!(
                "检测到重复域名 `{domain}`，每个域名只能激活一个目标。"
            ));
        }

        normalized.push(ManagedHostEntry {
            domain,
            ip,
            label,
            group_name,
        });
    }

    Ok(normalized)
}

fn collect_domains(domains: &[String]) -> Vec<String> {
    let mut unique = BTreeSet::new();

    for domain in domains {
        if let Ok(normalized) = normalize_domain(domain) {
            unique.insert(normalized);
        }
    }

    unique.into_iter().collect()
}

fn normalize_domain(domain: &str) -> Result<String, String> {
    let normalized = domain.trim().trim_end_matches('.').to_lowercase();

    if normalized.is_empty() {
        return Err("域名不能为空。".into());
    }

    if normalized.chars().any(char::is_whitespace) {
        return Err(format!("域名 `{normalized}` 不能包含空白字符。"));
    }

    Ok(normalized)
}

fn normalize_ip(ip: &str) -> Result<String, String> {
    let normalized = ip.trim();

    if normalized.is_empty() {
        return Err("IP 不能为空。".into());
    }

    IpAddr::from_str(normalized)
        .map(|address| address.to_string())
        .map_err(|_| format!("IP `{normalized}` 不是合法的 IPv4 / IPv6 地址。"))
}

fn normalize_label(label: &str, field_name: &str) -> Result<String, String> {
    let normalized = label.trim().replace('\n', " ");

    if normalized.is_empty() {
        return Err(format!("{field_name}不能为空。"));
    }

    Ok(normalized)
}

fn build_hosts_content(original_content: &str, entries: &[ManagedHostEntry]) -> String {
    let stripped = strip_managed_block(original_content).trim().to_string();

    if entries.is_empty() {
        return finalize_hosts_content(&stripped);
    }

    let managed_block = render_managed_block(entries);

    if stripped.is_empty() {
        finalize_hosts_content(&managed_block)
    } else {
        finalize_hosts_content(&format!("{managed_block}\n\n{stripped}"))
    }
}

fn strip_managed_block(content: &str) -> String {
    let mut lines = Vec::new();
    let mut inside_block = false;

    for line in content.lines() {
        let normalized_line = line.trim_end_matches('\r');

        if normalized_line == START_MARKER {
            inside_block = true;
            continue;
        }

        if normalized_line == END_MARKER {
            inside_block = false;
            continue;
        }

        if inside_block {
            continue;
        }

        lines.push(normalized_line);
    }

    lines.join("\n")
}

fn finalize_hosts_content(content: &str) -> String {
    if content.trim().is_empty() {
        String::new()
    } else {
        format!("{}\n", content.trim_end())
    }
}

fn render_managed_block(entries: &[ManagedHostEntry]) -> String {
    let mut lines = vec![START_MARKER.to_string(), MANAGED_NOTE.to_string()];

    for entry in entries {
        let comment = sanitize_comment(&format!("{} / {}", entry.group_name, entry.label));
        lines.push(format!("{}\t{}\t# {}", entry.ip, entry.domain, comment));
    }

    lines.push(END_MARKER.to_string());

    lines.join("\n")
}

fn sanitize_comment(comment: &str) -> String {
    comment
        .chars()
        .map(|character| match character {
            '\n' | '\r' | '\t' => ' ',
            _ => character,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn resolve_domain_states(content: &str, domains: &[String]) -> Vec<DomainState> {
    let domain_set: BTreeSet<&str> = domains.iter().map(String::as_str).collect();
    let mut first_match = BTreeMap::<String, (String, DomainSource)>::new();
    let mut all_matches = BTreeMap::<String, Vec<String>>::new();
    let mut inside_managed_block = false;

    for raw_line in content.lines() {
        let line = raw_line.trim_end_matches('\r');

        if line == START_MARKER {
            inside_managed_block = true;
            continue;
        }

        if line == END_MARKER {
            inside_managed_block = false;
            continue;
        }

        if let Some((ip, hosts)) = parse_hosts_line(line) {
            for host in hosts {
                if !domain_set.contains(host.as_str()) {
                    continue;
                }

                all_matches
                    .entry(host.clone())
                    .or_default()
                    .push(ip.clone());

                first_match.entry(host).or_insert_with(|| {
                    let source = if inside_managed_block {
                        DomainSource::Managed
                    } else {
                        DomainSource::External
                    };

                    (ip.clone(), source)
                });
            }
        }
    }

    domains
        .iter()
        .map(|domain| {
            let duplicates = all_matches
                .get(domain)
                .map(|ips| deduplicate_ips(ips))
                .unwrap_or_default();

            match first_match.get(domain) {
                Some((ip, source)) => DomainState {
                    domain: domain.clone(),
                    ip: Some(ip.clone()),
                    source: source.clone(),
                    duplicates,
                },
                None => DomainState {
                    domain: domain.clone(),
                    ip: None,
                    source: DomainSource::Missing,
                    duplicates,
                },
            }
        })
        .collect()
}

fn deduplicate_ips(ips: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut deduplicated = Vec::new();

    for ip in ips {
        if seen.insert(ip.clone()) {
            deduplicated.push(ip.clone());
        }
    }

    deduplicated
}

fn parse_hosts_line(line: &str) -> Option<(String, Vec<String>)> {
    let trimmed = line.split('#').next()?.trim();

    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let ip = parts.next()?.parse::<IpAddr>().ok()?.to_string();
    let hosts = parts.map(|host| host.to_lowercase()).collect::<Vec<_>>();

    if hosts.is_empty() {
        None
    } else {
        Some((ip, hosts))
    }
}

fn hosts_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(r"C:\Windows\System32\drivers\etc\hosts")
    }

    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/etc/hosts")
    }
}

fn create_temp_hosts_file(content: &str) -> Result<PathBuf, String> {
    let file_name = format!(
        "checkhosts-{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("生成临时文件名失败: {error}"))?
            .as_millis()
    );
    let path = std::env::temp_dir().join(file_name);

    fs::write(&path, content).map_err(|error| format!("写入临时 hosts 文件失败: {error}"))?;

    Ok(path)
}

#[cfg(target_os = "macos")]
fn write_hosts_file_with_admin(host_path: &Path, content: &str) -> Result<(), String> {
    let temp_path = create_temp_hosts_file(content)?;
    let shell_command = format!(
        "/bin/cp {temp} {hosts} && /bin/chmod 644 {hosts} && /usr/bin/dscacheutil -flushcache && /usr/bin/killall -HUP mDNSResponder",
        temp = shell_quote(temp_path.to_string_lossy().as_ref()),
        hosts = shell_quote(host_path.to_string_lossy().as_ref()),
    );
    let apple_script = format!(
        "do shell script \"{}\" with administrator privileges",
        escape_applescript_string(&shell_command)
    );
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(apple_script)
        .output()
        .map_err(|error| format!("调用系统管理员权限失败: {error}"))?;

    let _ = fs::remove_file(&temp_path);

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        if stderr.is_empty() {
            Err("管理员写入 hosts 失败。".into())
        } else {
            Err(format!("管理员写入 hosts 失败: {stderr}"))
        }
    }
}

#[cfg(target_os = "linux")]
fn write_hosts_file_with_admin(host_path: &Path, content: &str) -> Result<(), String> {
    let temp_path = create_temp_hosts_file(content)?;
    let shell_command = format!(
        "/bin/cp {temp} {hosts} && /bin/chmod 644 {hosts}",
        temp = shell_quote(temp_path.to_string_lossy().as_ref()),
        hosts = shell_quote(host_path.to_string_lossy().as_ref()),
    );
    let output = Command::new("pkexec")
        .arg("/bin/sh")
        .arg("-c")
        .arg(shell_command)
        .output()
        .map_err(|error| format!("调用管理员权限失败: {error}"))?;

    let _ = fs::remove_file(&temp_path);

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        if stderr.is_empty() {
            Err("管理员写入 hosts 失败。".into())
        } else {
            Err(format!("管理员写入 hosts 失败: {stderr}"))
        }
    }
}

#[cfg(target_os = "windows")]
fn write_hosts_file_with_admin(_host_path: &Path, _content: &str) -> Result<(), String> {
    Err("当前版本暂未实现 Windows hosts 写入，请在 macOS 或 Linux 下使用。".into())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'"'"'"#))
}

#[cfg(target_os = "macos")]
fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', r#"\\"#).replace('"', r#"\""#)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_hosts_status, apply_hosts])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
