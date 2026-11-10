// Single-file companion manager. Opening this window only inspects installation state.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace LunarStart.ConnectorManager
{
    internal sealed class ConnectorConfig
    {
        public bool draft { get; set; }
        public string[] extensionIds { get; set; }
    }

    internal sealed class InstallationRecord
    {
        public string kind { get; set; }
        public string installDirectory { get; set; }
        public string[] files { get; set; }
        public string[] extensionIds { get; set; }
        public string sha256 { get; set; }
    }

    internal sealed class HostManifest
    {
        public string name { get; set; }
        public string type { get; set; }
        public string path { get; set; }
        public string[] allowed_origins { get; set; }
    }

    internal enum InstallationState { NotInstalled, Installed, NeedsRepair }

    internal sealed class InstallationStatus
    {
        public InstallationState State;
        public bool FilesOk, ChromeOk, EdgeOk;
        public string[] ExtensionIds = new string[0];
        public readonly List<string> Issues = new List<string>();
    }

    internal class ConnectorBackend
    {
        internal const string HostName = "com.lunarfox.lunar_media";
        internal static readonly string[] ProductionRegistryPaths = {
            @"Software\Google\Chrome\NativeMessagingHosts\" + HostName,
            @"Software\Microsoft\Edge\NativeMessagingHosts\" + HostName
        };
        internal readonly string InstallRoot;
        internal readonly string[] RegistryPaths;
        internal readonly ConnectorConfig Config;
        internal readonly string PayloadDigest;
        private static readonly Regex IdPattern = new Regex("^[a-p]{32}$", RegexOptions.CultureInvariant);
        private static readonly Regex OwnedFilePattern = new Regex(@"^(?:LunarMediaHost-[a-f0-9]{12}\.exe|com\.lunarfox\.lunar_media\.json|Uninstall\.ps1|Uninstall\.cmd|installation\.json)$", RegexOptions.CultureInvariant);

        internal ConnectorBackend() : this(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"LunarStart\MediaConnector"), ProductionRegistryPaths) { }

        // Alternate locations are used only by the separately compiled verification harness.
        internal ConnectorBackend(string installRoot, string[] registryPaths)
        {
            InstallRoot = Path.GetFullPath(installRoot).TrimEnd(Path.DirectorySeparatorChar);
            RegistryPaths = registryPaths;
            Config = ReadJson<ConnectorConfig>(Encoding.UTF8.GetString(Resource("connector-config.json")).TrimStart('\uFEFF'));
            Config.extensionIds = ValidateIds(Config.extensionIds ?? new string[0], false);
            PayloadDigest = Digest(Resource("LunarMediaHost.exe"));
        }

        internal static byte[] Resource(string name)
        {
            using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload." + name))
            {
                if (source == null) throw new InvalidOperationException("Missing embedded file: " + name);
                using (MemoryStream output = new MemoryStream()) { source.CopyTo(output); return output.ToArray(); }
            }
        }

        internal static T ReadJson<T>(string json) { return new JavaScriptSerializer().Deserialize<T>(json); }
        internal static string Digest(byte[] bytes)
        {
            using (SHA256 sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        }
        internal static string[] ValidateIds(IEnumerable<string> values, bool requireOne)
        {
            string[] ids = values.Select(value => (value ?? "").Trim()).Where(value => value.Length != 0).Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToArray();
            if (ids.Any(id => !IdPattern.IsMatch(id)) || (requireOne && ids.Length == 0)) throw new ArgumentException("Use the 32-letter extension ID shown in player setup (lowercase a-p). / 请填写播放器设置中的 32 位扩展 ID（小写 a-p）。");
            return ids;
        }
        internal static string ReadRegistration(string path)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(path)) { return key == null ? "" : Convert.ToString(key.GetValue("")); }
        }
        private static bool SamePath(string first, string second)
        {
            try { return String.Equals(Path.GetFullPath(first), Path.GetFullPath(second), StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        internal InstallationStatus Inspect()
        {
            InstallationStatus status = new InstallationStatus();
            string markerPath = Path.Combine(InstallRoot, "installation.json"), manifestPath = Path.Combine(InstallRoot, HostName + ".json");
            string chrome = ReadRegistration(RegistryPaths[0]), edge = ReadRegistration(RegistryPaths[1]);
            bool connectorFiles = Directory.Exists(InstallRoot) && Directory.GetFiles(InstallRoot).Any(file => OwnedFilePattern.IsMatch(Path.GetFileName(file)));
            if (!connectorFiles && chrome.Length == 0 && edge.Length == 0) { status.State = InstallationState.NotInstalled; return status; }
            status.State = InstallationState.NeedsRepair;
            status.ChromeOk = SamePath(chrome, manifestPath);
            status.EdgeOk = SamePath(edge, manifestPath);
            if (!status.ChromeOk) status.Issues.Add("Chrome");
            if (!status.EdgeOk) status.Issues.Add("Edge");
            try
            {
                InstallationRecord marker = ReadJson<InstallationRecord>(File.ReadAllText(markerPath));
                // Keep valid saved IDs available for repair even if another owned file is missing.
                if (marker == null) throw new InvalidDataException("Installation record");
                status.ExtensionIds = ValidateIds(marker.extensionIds ?? new string[0], true);
                if (marker.kind != "LunarStart.WindowsMediaConnector" || !SamePath(marker.installDirectory, InstallRoot) || marker.files == null || marker.files.Length == 0) throw new InvalidDataException("Installation record");
                foreach (string name in marker.files)
                    if (!OwnedFilePattern.IsMatch(name ?? "") || !SamePath(Path.GetDirectoryName(Path.Combine(InstallRoot, name)), InstallRoot)) throw new InvalidDataException("File ownership");
                HostManifest manifest = ReadJson<HostManifest>(File.ReadAllText(manifestPath));
                string exeName = "LunarMediaHost-" + PayloadDigest.Substring(0, 12) + ".exe";
                if (manifest == null || manifest.name != HostName || manifest.type != "stdio" || !SamePath(manifest.path, Path.Combine(InstallRoot, exeName))) throw new InvalidDataException("Connector manifest");
                string[] expectedOrigins = status.ExtensionIds.Select(id => "chrome-extension://" + id + "/").OrderBy(value => value, StringComparer.Ordinal).ToArray();
                if (manifest.allowed_origins == null || !manifest.allowed_origins.OrderBy(value => value, StringComparer.Ordinal).SequenceEqual(expectedOrigins)) throw new InvalidDataException("Allowed extension IDs");
                if (Config.extensionIds.Except(status.ExtensionIds).Any()) throw new InvalidDataException("Package extension IDs");
                foreach (string name in new[] { exeName, HostName + ".json", "Uninstall.ps1", "Uninstall.cmd", "installation.json" })
                    if (!marker.files.Contains(name) || !File.Exists(Path.Combine(InstallRoot, name))) throw new InvalidDataException("Connector files");
                if (marker.sha256 != PayloadDigest || Digest(File.ReadAllBytes(manifest.path)) != PayloadDigest) throw new InvalidDataException("Connector version / SHA-256");
                foreach (string name in new[] { "Uninstall.ps1", "Uninstall.cmd" })
                    if (Digest(File.ReadAllBytes(Path.Combine(InstallRoot, name))) != Digest(Resource(name))) throw new InvalidDataException("Uninstall tools");
                status.FilesOk = true;
                if (status.ChromeOk && status.EdgeOk) status.State = InstallationState.Installed;
            }
            catch (Exception error)
            {
                if (!(error is IOException || error is InvalidDataException || error is UnauthorizedAccessException || error is ArgumentException || error is InvalidOperationException)) throw;
                status.Issues.Add(error.Message);
            }
            return status;
        }

        private static string Literal(string value) { return "'" + value.Replace("'", "''") + "'"; }

        internal virtual string Execute(bool uninstall, string[] extensionIds, bool prepareOnly = false)
        {
            string[] ids = uninstall ? new string[0] : ValidateIds(Config.extensionIds.Concat(extensionIds), true);
            // Different copies of the EXE cannot change this user's installation simultaneously.
            using (Mutex gate = new Mutex(false, @"Local\LunarStart.ConnectorManager.Operation"))
            {
                bool entered;
                try { entered = gate.WaitOne(0); } catch (AbandonedMutexException) { entered = true; }
                if (!entered) throw new InvalidOperationException("Another connector operation is running. / 另一个连接器管理窗口正在操作，请稍后重试。");
                string staging = Path.Combine(Path.GetTempPath(), "LunarConnectorManager-" + Guid.NewGuid().ToString("N"));
                try
                {
                    Directory.CreateDirectory(Path.Combine(staging, "payload"));
                    foreach (string name in new[] { "Install.ps1", "Uninstall.ps1", "Uninstall.cmd", "connector-config.json" }) File.WriteAllBytes(Path.Combine(staging, name), Resource(name));
                    File.WriteAllBytes(Path.Combine(staging, @"payload\LunarMediaHost.exe"), Resource("LunarMediaHost.exe"));
                    string script = Path.Combine(staging, uninstall ? "Uninstall.ps1" : "Install.ps1");
                    string command = "$ErrorActionPreference='Stop';[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);try { & " + Literal(script) + " -Yes -InstallDirectory " + Literal(InstallRoot);
                    if (!uninstall) command += " -Repair -ExtensionId @(" + String.Join(",", ids.Select(Literal)) + ")" + (prepareOnly ? " -PrepareOnly" : "");
                    command += "; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE } } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
                    ProcessStartInfo start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"), "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(command)));
                    start.UseShellExecute = false; start.CreateNoWindow = true;
                    start.RedirectStandardOutput = true; start.RedirectStandardError = true;
                    start.StandardOutputEncoding = Encoding.UTF8; start.StandardErrorEncoding = Encoding.UTF8;
                    using (Process process = Process.Start(start))
                    {
                        Task<string> stdout = process.StandardOutput.ReadToEndAsync(), stderr = process.StandardError.ReadToEndAsync();
                        process.WaitForExit(); Task.WaitAll(stdout, stderr);
                        string output = (stdout.Result + Environment.NewLine + stderr.Result).Trim();
                        if (process.ExitCode != 0) throw new InvalidOperationException(output.Length == 0 ? "Operation failed (" + process.ExitCode + ")." : output);
                        return output;
                    }
                }
                finally
                {
                    // Only this invocation's generated temporary directory is a cleanup target.
                    try
                    {
                        string temporaryRoot = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
                        if (SamePath(Path.GetDirectoryName(staging), temporaryRoot) && Path.GetFileName(staging).StartsWith("LunarConnectorManager-", StringComparison.Ordinal) && Directory.Exists(staging)) Directory.Delete(staging, true);
                    }
                    catch (IOException) { } catch (UnauthorizedAccessException) { }
                    gate.ReleaseMutex();
                }
            }
        }
    }

    internal sealed class ManagerForm : DarkWindow
    {
        private readonly ConnectorBackend backend;
        private readonly ManagerLocale locale;
        private bool busy, hasOperationOutput;
        private string activityKey;
        private InstallationStatus status;
        private readonly DarkLanguagePicker language = new DarkLanguagePicker();
        private readonly Label heading = new Label(), subtitle = new Label(), stateLabel = new Label(), stateHint = new Label(), filesLabel = new Label(), chromeLabel = new Label(), edgeLabel = new Label(), idsLabel = new Label(), idsHint = new Label(), pathLabel = new Label(), notice = new Label(), activity = new Label();
        private readonly DarkTextBox ids = new DarkTextBox(), location = new DarkTextBox(), details = new DarkTextBox();
        private readonly DarkButton install = new DarkButton(), repair = new DarkButton(), uninstall = new DarkButton(), refresh = new DarkButton();
        private readonly LinkLabel privacyLink = new LinkLabel(), termsLink = new LinkLabel(), repositoryLink = new LinkLabel();
        private readonly Color accent = DarkTheme.Success, ink = DarkTheme.Text;
        private readonly TableLayoutPanel layout = new TableLayoutPanel();

        internal ManagerForm(ConnectorBackend connector) : base(true)
        {
            backend = connector;
            locale = new ManagerLocale(Path.Combine(Path.GetDirectoryName(backend.InstallRoot), "connector-manager-language.txt"));
            ForeColor = ink; BackColor = DarkTheme.Background;
            AutoScaleDimensions = new SizeF(96, 96); AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(752, 850); MinimumSize = new Size(712, 822); StartPosition = FormStartPosition.CenterScreen;
            layout.Dock = DockStyle.Fill; layout.Padding = new Padding(28, 16, 28, 22); layout.ColumnCount = 1;
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            Content.Controls.Add(layout);
            FlowLayoutPanel footer = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(28, 0, 28, 12), WrapContents = true };
            foreach (LinkLabel link in new[] { privacyLink, termsLink, repositoryLink })
            {
                link.AutoSize = true; link.LinkColor = DarkTheme.Success; link.ActiveLinkColor = DarkTheme.Text; link.VisitedLinkColor = DarkTheme.Success; link.LinkBehavior = LinkBehavior.HoverUnderline; link.Margin = new Padding(0, 4, 24, 4);
                link.LinkClicked += delegate(object sender, LinkLabelLinkClickedEventArgs args) { OpenLink((LinkLabel)sender); };
                footer.Controls.Add(link);
            }
            Content.Controls.Add(footer);
            TableLayoutPanel header = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 3, Margin = new Padding(0, 0, 0, 10) };
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 54)); header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 180));
            PictureBox logo = new PictureBox { Size = new Size(42, 42), SizeMode = PictureBoxSizeMode.Zoom, Margin = new Padding(0, 0, 12, 0) };
            using (MemoryStream image = new MemoryStream(ConnectorBackend.Resource("logo.png"))) logo.Image = new Bitmap(image);
            heading.Font = new Font(Font.FontFamily, 21F, FontStyle.Bold); heading.AutoSize = true; heading.Margin = new Padding(0);
            language.SelectedIndex = Array.IndexOf(ManagerLocale.Codes, locale.Code); language.Dock = DockStyle.Top; language.Height = 32; language.Margin = new Padding(4, 6, 0, 0);
            header.Controls.Add(logo, 0, 0); header.Controls.Add(heading, 1, 0); header.Controls.Add(language, 2, 0); Add(header);
            AddText(subtitle, 4, 17);
            TableLayoutPanel card = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 1, BackColor = DarkTheme.Surface, Padding = new Padding(18), Margin = new Padding(0, 0, 0, 18) };
            stateLabel.Font = new Font(Font.FontFamily, 18F, FontStyle.Bold);
            foreach (Label label in new[] { stateLabel, stateHint, filesLabel, chromeLabel, edgeLabel }) { label.AutoSize = true; label.Dock = DockStyle.Top; label.Margin = new Padding(0, 0, 0, 7); card.Controls.Add(label); }
            Add(card);
            idsLabel.Font = new Font(Font, FontStyle.Bold); AddText(idsLabel, 0, 7);
            ids.AccessibleName = "Extension IDs"; Add(Field(ids, false));
            idsHint.ForeColor = DarkTheme.Muted; AddText(idsHint, 0, 14);
            pathLabel.Font = new Font(Font, FontStyle.Bold); AddText(pathLabel, 0, 6);
            location.Text = backend.InstallRoot; location.ReadOnly = true; location.BorderStyle = BorderStyle.None; location.BackColor = BackColor; location.Dock = DockStyle.Top; location.Margin = new Padding(0, 0, 0, 14); Add(location);
            AddText(notice, 0, 16);
            TableLayoutPanel actions = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 4, Margin = new Padding(0, 0, 0, 10) };
            int index = 0;
            foreach (DarkButton button in new[] { install, repair, uninstall, refresh })
            {
                actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25)); button.Dock = DockStyle.Fill; button.Height = 42; button.Margin = new Padding(index == 0 ? 0 : 5, 0, index == 3 ? 0 : 5, 0); actions.Controls.Add(button, index++, 0);
            }
            install.Primary = true;
            Add(actions); AddText(activity, 0, 8);
            details.Multiline = true; details.ReadOnly = true; details.ScrollBars = ScrollBars.None; details.AccessibleName = "Operation details";
            details.AccessibleDescription = "Scroll with the mouse wheel or arrow keys. Select and copy text with Ctrl+A and Ctrl+C.";
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); layout.Controls.Add(Field(details, true), 0, layout.RowCount++);
            language.SelectedIndexChanged += delegate { locale.Select(ManagerLocale.Codes[language.SelectedIndex], true); Localize(); };
            install.Click += async delegate { await RunOperation(false); };
            repair.Click += async delegate { await RunOperation(false); };
            uninstall.Click += async delegate { await RunOperation(true); };
            refresh.Click += delegate { hasOperationOutput = false; details.Clear(); RefreshStatus(false); };
            Activated += delegate { if (!busy) RefreshStatus(false); };
            FormClosing += delegate(object sender, FormClosingEventArgs args) { if (busy) args.Cancel = true; };
            RefreshStatus(true); Localize();
        }

        private void Add(Control control) { layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.Controls.Add(control, 0, layout.RowCount++); }
        private static Panel Field(TextBox editor, bool fill)
        {
            Panel border = new Panel { Dock = fill ? DockStyle.Fill : DockStyle.Top, BackColor = DarkTheme.Border, Padding = new Padding(1), Height = 38, Margin = new Padding(0, 0, 0, 6) };
            Panel inset = new Panel { Dock = DockStyle.Fill, BackColor = DarkTheme.Input, Padding = new Padding(10, 8, 10, 8) };
            editor.Dock = DockStyle.Fill; editor.Margin = Padding.Empty; inset.Controls.Add(editor); border.Controls.Add(inset); return border;
        }
        private void AddText(Label label, int top, int bottom) { label.AutoSize = true; label.Dock = DockStyle.Top; label.Margin = new Padding(0, top, 0, bottom); Add(label); }
        private string T(string key) { return locale.T(key); }
        private void SetActivity(string key) { activityKey = key; activity.Text = T(key); }
        private void OpenLink(LinkLabel link)
        {
            string url = (string)link.Tag;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception) { DarkPrompt.Show(this, T("link_failed") + "\r\n\r\n" + url, T("link_failed_title"), false, locale); }
        }
        private void Localize()
        {
            SuspendLayout();
            layout.SuspendLayout();
            ApplyWindowLanguage(locale); Text = T("window_title");
            ids.Locale = location.Locale = details.Locale = locale;
            language.AccessibleName = T("language");
            heading.Text = T("heading"); subtitle.Text = T("subtitle");
            idsLabel.Text = T("ids_label"); ids.AccessibleName = T("ids_label");
            idsHint.Text = T(backend.Config.draft ? "ids_draft_hint" : "ids_official_hint");
            pathLabel.Text = T("path_label"); location.AccessibleName = T("path_label");
            notice.Text = T("notice");
            install.Text = T("install"); repair.Text = T("repair"); uninstall.Text = T("uninstall"); refresh.Text = T("refresh");
            details.AccessibleName = T("operation_details"); details.AccessibleDescription = T("details_scroll");
            privacyLink.Text = T("privacy") + " ↗"; privacyLink.Tag = locale.PrivacyUrl; privacyLink.AccessibleDescription = locale.PrivacyUrl;
            termsLink.Text = T("terms") + " ↗"; termsLink.Tag = locale.TermsUrl; termsLink.AccessibleDescription = locale.TermsUrl;
            repositoryLink.Text = T("repository") + " ↗"; repositoryLink.Tag = ManagerLocale.RepositoryUrl; repositoryLink.AccessibleDescription = ManagerLocale.RepositoryUrl;
            if (activityKey != null) activity.Text = T(activityKey);
            if (!hasOperationOutput) details.Clear();
            RenderStatus(); layout.ResumeLayout(true); ResumeLayout(true);
        }
        private void RefreshStatus(bool fillIds)
        {
            try
            {
                status = backend.Inspect();
                if (fillIds || String.IsNullOrWhiteSpace(ids.Text)) ids.Text = String.Join(", ", backend.Config.extensionIds.Concat(status.ExtensionIds).Distinct());
            }
            catch (Exception error)
            {
                status = new InstallationStatus { State = InstallationState.NeedsRepair };
                status.Issues.Add(error.Message);
                details.Text = error.Message;
            }
            RenderStatus();
        }
        private void RenderStatus()
        {
            if (status == null) return;
            bool installed = status.State == InstallationState.Installed, missing = status.State == InstallationState.NotInstalled;
            stateLabel.Text = T(installed ? "installed" : missing ? "not_installed" : "needs_repair");
            stateLabel.ForeColor = installed ? accent : missing ? ink : DarkTheme.Warning;
            stateHint.Text = T(installed ? "installed_hint" : missing ? "not_installed_hint" : "needs_repair_hint");
            if (!busy && String.IsNullOrEmpty(details.Text)) details.Text = status.Issues.Count == 0
                ? T("details_idle")
                : T("details_heading") + "\r\n" + String.Join("\r\n", status.Issues);
            filesLabel.Text = T("files_label") + Check(status.FilesOk, missing);
            chromeLabel.Text = "Chrome: " + Check(status.ChromeOk, missing);
            edgeLabel.Text = "Edge: " + Check(status.EdgeOk, missing);
            install.Enabled = !busy && missing; repair.Enabled = !busy && !missing; uninstall.Enabled = !busy && !missing; refresh.Enabled = !busy; ids.Enabled = !busy; language.Enabled = !busy;
        }
        private string Check(bool ok, bool missing) { return T(ok ? "check_ok" : missing ? "check_missing" : "check_repair"); }

        private async Task RunOperation(bool remove)
        {
            string[] extensionIds;
            try { extensionIds = remove ? new string[0] : ConnectorBackend.ValidateIds(Regex.Split(ids.Text, @"[,;\s]+"), true); }
            catch (ArgumentException) { DarkPrompt.Show(this, T("invalid_id"), T("invalid_id_title"), false, locale); return; }
            if (remove && DarkPrompt.Show(this, T("uninstall_confirm"), T("uninstall_title"), true, locale) != DialogResult.Yes) return;
            busy = true; hasOperationOutput = true; UseWaitCursor = true; RenderStatus();
            SetActivity(remove ? "working_uninstall" : "working_install"); details.Clear();
            try
            {
                details.Text = await Task.Run(() => backend.Execute(remove, extensionIds));
                RefreshStatus(false);
                bool complete = remove ? status.State == InstallationState.NotInstalled : status.State == InstallationState.Installed;
                SetActivity(complete ? (remove ? "uninstall_done" : "install_done") : "incomplete");
            }
            catch (Exception error) { details.Text = error.Message; SetActivity("operation_failed"); RefreshStatus(false); }
            finally { busy = false; UseWaitCursor = false; RenderStatus(); }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            try { Application.Run(new ManagerForm(new ConnectorBackend())); }
            catch (Exception error)
            {
                ManagerLocale locale = new ManagerLocale();
                DarkPrompt.Show(null, locale.T("startup_failed") + "\n\n" + error.Message, "Lunar Start", false, locale);
            }
        }
    }
}
