using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace LunarStart.ConnectorManager
{
    internal static class DarkTheme
    {
        internal static readonly Color Background = Color.FromArgb(16, 23, 21);
        internal static readonly Color Surface = Color.FromArgb(25, 35, 31);
        internal static readonly Color Input = Color.FromArgb(12, 19, 16);
        internal static readonly Color Border = Color.FromArgb(49, 69, 60);
        internal static readonly Color Text = Color.FromArgb(225, 235, 228);
        internal static readonly Color Muted = Color.FromArgb(160, 181, 168);
        internal static readonly Color Accent = Color.FromArgb(40, 77, 60);
        internal static readonly Color Hover = Color.FromArgb(45, 62, 52);
        internal static readonly Color Success = Color.FromArgb(144, 189, 157);
        internal static readonly Color Warning = Color.FromArgb(213, 178, 123);
    }

    internal static class WindowGeometry
    {
        internal static GraphicsPath RoundedRectangle(RectangleF bounds, float radius)
        {
            GraphicsPath outline = new GraphicsPath();
            float diameter = Math.Min(radius * 2, Math.Min(bounds.Width, bounds.Height));
            if (diameter <= 0) { outline.AddRectangle(bounds); return outline; }
            outline.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
            outline.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
            outline.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            outline.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            outline.CloseFigure();
            return outline;
        }
    }

    // Paint every state ourselves so Windows' light theme cannot flash on hover,
    // focus or disabled controls. Button keyboard/accessibility behavior is retained.
    internal class DarkButton : Button
    {
        internal bool Primary;
        internal bool CloseButton;
        private bool hovered, pressed;
        internal DarkButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = DarkTheme.Surface; ForeColor = DarkTheme.Text;
            FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; UseVisualStyleBackColor = false;
            Cursor = Cursors.Hand;
        }
        protected override void OnPaint(PaintEventArgs args)
        {
            Color background = !Enabled ? DarkTheme.Surface : pressed ? DarkTheme.Background : hovered ? (CloseButton ? Color.FromArgb(105, 45, 46) : DarkTheme.Hover) : Primary ? DarkTheme.Accent : BackColor;
            args.Graphics.Clear(background);
            using (Pen border = new Pen(Focused && Enabled ? DarkTheme.Success : DarkTheme.Border)) args.Graphics.DrawRectangle(border, 0, 0, Width - 1, Height - 1);
            TextRenderer.DrawText(args.Graphics, Text, Font, ClientRectangle, Enabled ? ForeColor : DarkTheme.Muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
        protected override void OnMouseEnter(EventArgs args) { hovered = true; base.OnMouseEnter(args); Invalidate(); }
        protected override void OnMouseLeave(EventArgs args) { hovered = pressed = false; base.OnMouseLeave(args); Invalidate(); }
        protected override void OnMouseDown(MouseEventArgs args) { pressed = true; base.OnMouseDown(args); Invalidate(); }
        protected override void OnMouseUp(MouseEventArgs args) { pressed = false; base.OnMouseUp(args); Invalidate(); }
        protected override void OnEnabledChanged(EventArgs args) { base.OnEnabledChanged(args); Invalidate(); }
        protected override void OnGotFocus(EventArgs args) { base.OnGotFocus(args); Invalidate(); }
        protected override void OnLostFocus(EventArgs args) { base.OnLostFocus(args); Invalidate(); }
    }

    internal sealed class DarkLanguagePicker : DarkButton
    {
        private int selectedIndex = -1;
        private readonly ContextMenuStrip choices;
        public event EventHandler SelectedIndexChanged;
        internal DarkLanguagePicker()
        {
            choices = new ContextMenuStrip { ShowImageMargin = false, ShowCheckMargin = false, BackColor = DarkTheme.Surface, ForeColor = DarkTheme.Text, Renderer = new DarkMenuRenderer() };
            for (int index = 0; index < ManagerLocale.Codes.Length; index++)
            {
                int choice = index;
                ToolStripMenuItem item = new ToolStripMenuItem(ManagerLocale.Names[index]);
                item.Click += delegate { SelectedIndex = choice; Focus(); };
                choices.Items.Add(item);
            }
            choices.Opening += delegate
            {
                for (int index = 0; index < choices.Items.Count; index++) choices.Items[index].Text = (index == SelectedIndex ? "•  " : "   ") + ManagerLocale.Names[index];
            };
            ContextMenuStrip = choices;
        }
        public int SelectedIndex
        {
            get { return selectedIndex; }
            set
            {
                if (value == selectedIndex) return;
                selectedIndex = value >= 0 && value < ManagerLocale.Codes.Length ? value : 1;
                Text = ManagerLocale.Names[selectedIndex] + "  ▾";
                Invalidate();
                if (SelectedIndexChanged != null) SelectedIndexChanged(this, EventArgs.Empty);
            }
        }
        protected override void OnClick(EventArgs args) { choices.Show(this, new Point(0, Height)); base.OnClick(args); }
        protected override void OnKeyDown(KeyEventArgs args)
        {
            if (args.KeyCode == Keys.Down || args.KeyCode == Keys.Up)
            {
                SelectedIndex = (SelectedIndex + ManagerLocale.Codes.Length + (args.KeyCode == Keys.Down ? 1 : -1)) % ManagerLocale.Codes.Length;
                args.Handled = true; return;
            }
            base.OnKeyDown(args);
        }
    }

    internal sealed class DarkTextBox : TextBox
    {
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        internal ManagerLocale Locale;
        internal DarkTextBox()
        {
            BackColor = DarkTheme.Input; ForeColor = DarkTheme.Text;
            BorderStyle = BorderStyle.None;
            ContextMenuStrip menu = new ContextMenuStrip { ShowImageMargin = false, BackColor = DarkTheme.Surface, ForeColor = DarkTheme.Text, Renderer = new DarkMenuRenderer() };
            ToolStripMenuItem copy = new ToolStripMenuItem(), paste = new ToolStripMenuItem(), all = new ToolStripMenuItem();
            copy.Click += delegate { Copy(); }; paste.Click += delegate { Paste(); }; all.Click += delegate { Focus(); SelectAll(); };
            menu.Items.AddRange(new ToolStripItem[] { copy, paste, all });
            menu.Opening += delegate
            {
                copy.Text = Locale == null ? "Copy" : Locale.T("copy"); paste.Text = Locale == null ? "Paste" : Locale.T("paste"); all.Text = Locale == null ? "Select all" : Locale.T("select_all");
                copy.Enabled = SelectionLength > 0; paste.Enabled = !ReadOnly; all.Enabled = TextLength > 0;
            };
            ContextMenuStrip = menu;
        }
        protected override void WndProc(ref Message message)
        {
            // Scroll long logs without an OS-painted light scrollbar.
            if (message.Msg == 0x020A && Multiline)
            {
                int delta = unchecked((short)((long)message.WParam >> 16));
                SendMessage(Handle, 0x00B6, IntPtr.Zero, new IntPtr(-delta / 120 * 3));
                return;
            }
            base.WndProc(ref message);
        }
    }

    internal sealed class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        internal DarkMenuRenderer() : base(new DarkMenuColors()) { }
        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs args)
        {
            args.TextColor = args.Item.Enabled ? DarkTheme.Text : DarkTheme.Muted;
            base.OnRenderItemText(args);
        }
        private sealed class DarkMenuColors : ProfessionalColorTable
        {
            public override Color ToolStripDropDownBackground { get { return DarkTheme.Surface; } }
            public override Color MenuBorder { get { return DarkTheme.Border; } }
            public override Color MenuItemBorder { get { return DarkTheme.Border; } }
            public override Color MenuItemSelected { get { return DarkTheme.Hover; } }
            public override Color MenuItemSelectedGradientBegin { get { return DarkTheme.Hover; } }
            public override Color MenuItemSelectedGradientEnd { get { return DarkTheme.Hover; } }
        }
    }

    // A fully painted title bar also stays dark on supported Windows 10 versions
    // whose native caption does not follow the application's colors.
    internal class DarkWindow : Form
    {
        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
        [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref FrameMargins margins);
        [StructLayout(LayoutKind.Sequential)]
        private struct FrameMargins { public int Left, Right, Top, Bottom; }
        protected readonly Panel Content = new Panel();
        private readonly Label caption = new Label();
        private readonly DarkButton minimizeButton, maximizeButton, closeButton;
        private readonly bool fullWindowControls;
        private bool nativeCorners;
        private float cornerRadius = 8;
        internal bool CanResize = true;

        internal DarkWindow(bool fullControls)
        {
            fullWindowControls = fullControls;
            FormBorderStyle = FormBorderStyle.None; BackColor = DarkTheme.Background; ForeColor = DarkTheme.Text;
            Font = new Font("Segoe UI", 10F); Padding = new Padding(6); DoubleBuffered = true;
            AutoScaleDimensions = new SizeF(96, 96); AutoScaleMode = AutoScaleMode.Dpi;
            using (MemoryStream source = new MemoryStream(ConnectorBackend.Resource("app.ico")))
            using (Icon icon = new Icon(source)) Icon = (Icon)icon.Clone();
            Content.Dock = DockStyle.Fill; Content.BackColor = BackColor; Controls.Add(Content);
            Panel titleBar = new Panel { Dock = DockStyle.Top, Height = 36, BackColor = DarkTheme.Background, Padding = new Padding(7, 3, 0, 3) };
            PictureBox iconBox = new PictureBox { Dock = DockStyle.Left, Width = 22, SizeMode = PictureBoxSizeMode.Zoom };
            using (MemoryStream logo = new MemoryStream(ConnectorBackend.Resource("logo.png"))) iconBox.Image = new Bitmap(logo);
            caption.ForeColor = DarkTheme.Muted; caption.AutoSize = false; caption.TextAlign = ContentAlignment.MiddleLeft; caption.Dock = DockStyle.Fill; caption.Padding = new Padding(9, 0, 0, 0);
            FlowLayoutPanel buttons = new FlowLayoutPanel { Dock = DockStyle.Right, Width = fullControls ? 120 : 40, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = Padding.Empty, Padding = Padding.Empty };
            if (fullControls)
            {
                minimizeButton = CaptionButton("−", "Minimize"); maximizeButton = CaptionButton("□", "Maximize / restore");
                minimizeButton.Click += delegate { WindowState = FormWindowState.Minimized; };
                maximizeButton.Click += delegate { WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; };
                buttons.Controls.Add(minimizeButton); buttons.Controls.Add(maximizeButton);
            }
            closeButton = CaptionButton("×", "Close"); closeButton.CloseButton = true; closeButton.Click += delegate { Close(); }; buttons.Controls.Add(closeButton);
            titleBar.Controls.Add(caption); titleBar.Controls.Add(buttons); titleBar.Controls.Add(iconBox);
            titleBar.MouseDown += DragTitle; caption.MouseDown += DragTitle; iconBox.MouseDown += DragTitle;
            if (fullControls) caption.DoubleClick += delegate { WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; };
            Controls.Add(titleBar);
        }
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                // Retain native frame semantics for DWM corners/shadows while
                // WM_NCCALCSIZE below keeps our dark title bar in the client area.
                parameters.Style |= 0x00C00000 | 0x00080000; // WS_CAPTION | WS_SYSMENU
                if (fullWindowControls) parameters.Style |= 0x00040000 | 0x00020000 | 0x00010000;
                return parameters;
            }
        }
        internal void ApplyWindowLanguage(ManagerLocale locale)
        {
            if (minimizeButton != null) minimizeButton.AccessibleName = locale.T("minimize");
            if (maximizeButton != null) maximizeButton.AccessibleName = locale.T("maximize");
            closeButton.AccessibleName = locale.T("close");
        }
        private static DarkButton CaptionButton(string text, string name)
        {
            return new DarkButton { Text = text, AccessibleName = name, Size = new Size(40, 30), Margin = Padding.Empty, TabStop = false, Font = new Font("Segoe UI", 12F) };
        }
        private void DragTitle(object sender, MouseEventArgs args)
        {
            if (args.Button != MouseButtons.Left || args.Clicks != 1) return;
            ReleaseCapture(); SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
        }
        protected override void OnTextChanged(EventArgs args) { base.OnTextChanged(args); if (caption != null) caption.Text = Text; }
        protected override void OnHandleCreated(EventArgs args)
        {
            base.OnHandleCreated(args);
            MaximizedBounds = Screen.FromHandle(Handle).WorkingArea;
            using (Graphics graphics = CreateGraphics()) cornerRadius = 8 * graphics.DpiX / 96;
            try
            {
                int preference = 2; // DWMWCP_ROUND; Windows 11 manages the actual clipping.
                nativeCorners = DwmSetWindowAttribute(Handle, 33, ref preference, sizeof(int)) == 0;
                if (nativeCorners)
                {
                    int dark = 1, border = ColorTranslator.ToWin32(DarkTheme.Border);
                    DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
                    DwmSetWindowAttribute(Handle, 34, ref border, sizeof(int));
                    FrameMargins margins = new FrameMargins { Left = 1, Right = 1, Top = 1, Bottom = 1 };
                    DwmExtendFrameIntoClientArea(Handle, ref margins);
                }
            }
            catch (DllNotFoundException) { nativeCorners = false; }
            catch (EntryPointNotFoundException) { nativeCorners = false; }
            UpdateWindowCorners();
        }
        private void UpdateWindowCorners()
        {
            if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
            bool normal = WindowState == FormWindowState.Normal;
            Region previous = Region;
            if (nativeCorners)
            {
                // Window regions disable DWM rounding, so native windows must
                // stay unshaped. Maximized windows use square edges.
                if (previous != null) Region = null;
                int preference = normal ? 2 : 1;
                DwmSetWindowAttribute(Handle, 33, ref preference, sizeof(int));
            }
            else if (normal)
            {
                using (GraphicsPath outline = WindowGeometry.RoundedRectangle(new RectangleF(0, 0, Width, Height), cornerRadius)) Region = new Region(outline);
            }
            else if (previous != null) Region = null;
            if (previous != null) previous.Dispose();
            Invalidate();
        }
        protected override void OnResize(EventArgs args) { base.OnResize(args); UpdateWindowCorners(); }
        protected override void OnPaint(PaintEventArgs args)
        {
            base.OnPaint(args);
            if (Width <= 1 || Height <= 1) return;
            GraphicsState state = args.Graphics.Save();
            args.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (Pen border = new Pen(DarkTheme.Border))
            using (GraphicsPath outline = WindowGeometry.RoundedRectangle(new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), WindowState == FormWindowState.Normal ? cornerRadius : 0)) args.Graphics.DrawPath(border, outline);
            args.Graphics.Restore(state);
        }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0083) { message.Result = IntPtr.Zero; return; } // WM_NCCALCSIZE
            if (message.Msg == 0x0085) { message.Result = IntPtr.Zero; return; } // WM_NCPAINT: custom dark chrome
            if (message.Msg == 0x0086) message.LParam = new IntPtr(-1); // WM_NCACTIVATE: update state without painting a system caption
            if (message.Msg == 0x0317) message.LParam = new IntPtr((long)message.LParam & ~2L); // WM_PRINT: omit PRF_NONCLIENT
            base.WndProc(ref message);
            if (message.Msg != 0x0084 || !CanResize || WindowState != FormWindowState.Normal) return;
            long coordinates = (long)message.LParam;
            Point point = PointToClient(new Point(unchecked((short)coordinates), unchecked((short)(coordinates >> 16))));
            bool left = point.X < 6, right = point.X >= Width - 6, top = point.Y < 6, bottom = point.Y >= Height - 6;
            if (left && top) message.Result = new IntPtr(13);
            else if (right && top) message.Result = new IntPtr(14);
            else if (left && bottom) message.Result = new IntPtr(16);
            else if (right && bottom) message.Result = new IntPtr(17);
            else if (left) message.Result = new IntPtr(10);
            else if (right) message.Result = new IntPtr(11);
            else if (top) message.Result = new IntPtr(12);
            else if (bottom) message.Result = new IntPtr(15);
        }
    }

    internal sealed class DarkPrompt : DarkWindow
    {
        internal DarkPrompt(string message, string title, bool confirmation, ManagerLocale locale) : base(false)
        {
            ApplyWindowLanguage(locale);
            CanResize = false; Text = title; ClientSize = new Size(560, 320); ShowInTaskbar = false; StartPosition = FormStartPosition.CenterParent;
            Content.Padding = new Padding(24);
            TableLayoutPanel body = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); body.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); body.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            Label copy = new Label { Text = message, Dock = DockStyle.Fill, ForeColor = DarkTheme.Text, Margin = new Padding(0, 0, 0, 14) };
            FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
            DarkButton accept = new DarkButton { Text = locale.T(confirmation ? "uninstall" : "ok"), Primary = !confirmation, Size = new Size(142, 38), DialogResult = confirmation ? DialogResult.Yes : DialogResult.OK };
            actions.Controls.Add(accept);
            if (confirmation)
            {
                DarkButton cancel = new DarkButton { Text = locale.T("cancel"), Size = new Size(142, 38), DialogResult = DialogResult.Cancel };
                actions.Controls.Add(cancel); CancelButton = cancel; AcceptButton = cancel;
                Shown += delegate { cancel.Focus(); };
            }
            else { CancelButton = accept; AcceptButton = accept; }
            body.Controls.Add(copy, 0, 0); body.Controls.Add(actions, 0, 1); Content.Controls.Add(body);
        }
        internal static DialogResult Show(IWin32Window owner, string message, string title, bool confirmation, ManagerLocale locale)
        {
            using (DarkPrompt prompt = new DarkPrompt(message, title, confirmation, locale)) return prompt.ShowDialog(owner);
        }
    }
}
