package com.hmdev.messaging.agent.example;

import com.hmdev.messaging.common.util.LogUtils;
import dev.onvoid.webrtc.media.video.I420Buffer;
import dev.onvoid.webrtc.media.video.VideoFrame;
import dev.onvoid.webrtc.media.video.VideoFrameBuffer;
import dev.onvoid.webrtc.media.video.VideoTrackSink;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.swing.*;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public class BasicVideoRenderer extends JPanel implements VideoTrackSink {

    private static final Logger logger = LoggerFactory.getLogger(BasicVideoRenderer.class);

    private final AtomicReference<Dimension> size = new AtomicReference<>(new Dimension(640, 480));
    private final AtomicReference<BufferedImage> currentFrame = new AtomicReference<>();
    private volatile boolean active = true;
    private final AtomicInteger frameCount = new AtomicInteger(0);
    private final AtomicInteger fps = new AtomicInteger(0);

    public BasicVideoRenderer() {
        setBackground(Color.BLACK);
        setPreferredSize(size.get());
    }

    @Override
    public void onVideoFrame(VideoFrame frame) {
        if (!active) {
            frame.release();
            return;
        }

        try {
            VideoFrameBuffer buffer = frame.buffer;
            int w = buffer.getWidth();
            int h = buffer.getHeight();


            // Convert video frame buffer to BufferedImage
            BufferedImage image = convertFrameToImage(buffer, w, h);
            if (image != null) {
                // File outputFile = new File(String.format("output{%s}.png", new Date().getTime()));
                //ImageIO.write(image, "png", outputFile);
                currentFrame.set(image);
                size.set(new Dimension(w, h));
            }

            SwingUtilities.invokeLater(this::repaint);
        } catch (Throwable e) {
            LogUtils.logError(logger, "Error processing video frame", e);
        } finally {
            frame.release();
        }
    }

    private BufferedImage convertFrameToImage(VideoFrameBuffer buffer, int width, int height) {
        try {
            // Create a BufferedImage from the video frame buffer
            BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);

            //buffer.retain();  // increment ref count
            I420Buffer i420 = buffer.toI420();
            ByteBuffer yBuf = i420.getDataY();
            ByteBuffer uBuf = i420.getDataU();
            ByteBuffer vBuf = i420.getDataV();
            int strideY = i420.getStrideY();
            int strideU = i420.getStrideU();
            int strideV = i420.getStrideV();

            // Convert YUV to RGB and set pixels
            int[] rgbArray = new int[width * height];
            yBuf.rewind();
            uBuf.rewind();
            vBuf.rewind();

            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    int yIndex = y * strideY + x;
                    int uvIndex = (y / 2) * strideU + (x / 2);

                    int yValue = yBuf.get(yIndex) & 0xFF;
                    int uValue = uBuf.get(uvIndex) & 0xFF;
                    int vValue = vBuf.get(uvIndex) & 0xFF;

                    // YUV to RGB conversion
                    int c = yValue - 16;
                    int d = uValue - 128;
                    int e = vValue - 128;

                    int r = (298 * c + 409 * e + 128) >> 8;
                    int g = (298 * c - 100 * d - 208 * e + 128) >> 8;
                    int b = (298 * c + 516 * d + 128) >> 8;

                    // Clamp values to 0-255 range
                    r = Math.max(0, Math.min(255, r));
                    g = Math.max(0, Math.min(255, g));
                    b = Math.max(0, Math.min(255, b));

                    rgbArray[y * width + x] = (r << 16) | (g << 8) | b;
                }
            }

            image.setRGB(0, 0, width, height, rgbArray, 0, width);
            //i420.release();
            //buffer.release();  // decrement ref count

            return image;
        } catch (Exception e) {
            LogUtils.logError(logger, "Error converting frame to image", e);
            return null;
        }
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);

        BufferedImage frame = currentFrame.get();
        if (frame != null) {
            // Draw the video frame
            g.drawImage(frame, 0, 0, getWidth(), getHeight(), this);
        }

        // Draw overlay information
        Graphics2D g2d = (Graphics2D) g;
        g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2d.setColor(new Color(0, 255, 0, 200)); // Semi-transparent green
        g2d.setFont(new Font("Arial", Font.BOLD, 14));

        String status = frame != null ? "● Streaming" : "Waiting for frames...";
        g2d.drawString(status, 10, 20);
        g2d.drawString("FPS: " + fps.get(), 10, 40);

        Dimension dim = size.get();
        g2d.setFont(new Font("Arial", Font.PLAIN, 12));
        g2d.drawString(dim.width + "x" + dim.height + "px", 10, getHeight() - 10);
    }

    public void stop() {
        active = false;
    }

    public int getFrameCount() {
        return frameCount.get();
    }

    public int getFPS() {
        return fps.get();
    }

    // simple demo
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame f = new JFrame("WebRTC Stream");
            BasicVideoRenderer r = new BasicVideoRenderer();
            f.setDefaultCloseOperation(WindowConstants.EXIT_ON_CLOSE);
            f.add(r);
            f.pack();
            f.setVisible(true);

            logger.info("Attach this renderer to your VideoTrack via addSink(r)");
        });
    }
}
