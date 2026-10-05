# 论文图片与视频

每篇论文左侧的 `.pub-media` 是独立媒体位。`data-media-id="01"` 到 `"12"` 对应当前论文顺序，编号显示在占位框右下角。编辑 `index.html` 中对应的媒体位即可加入素材；保留外层 `.pub-media`，将里面的 `.media-placeholder` 替换为以下任意一种写法。

## 图片

将图片放到 `images` 目录，例如 `images/paper-01.jpg`：

```html
<div class="pub-media" data-media-id="01">
  <a href="images/paper-01.jpg" target="_blank" rel="noopener noreferrer">
    <img src="images/paper-01.jpg" alt="填写这篇论文图片的简短描述" loading="lazy">
  </a>
</div>
```

图片会在固定比例的区域内完整显示，点击可查看原图。

## 视频

创建 `videos` 目录并加入视频，例如 `videos/paper-01.mp4`。将媒体位内容改为：

```html
<div class="pub-media" data-media-id="01">
  <video src="videos/paper-01.mp4" controls playsinline preload="none"
         aria-label="填写这篇论文演示视频的简短描述"></video>
</div>
```

浏览器会显示播放控件，视频由访客点击播放。可添加 `poster="images/paper-01.jpg"` 指定封面；有语音的视频可添加字幕 `<track>`。桌面媒体位宽 140 像素，手机端宽 96 或 80 像素，显示比例为 16:10。文件名建议使用小写字母、数字和连字符，并确保大小写与 HTML 路径一致。
